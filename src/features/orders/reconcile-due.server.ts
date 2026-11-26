import "server-only";
import type { OwnerContext } from "../identity/access.server";
import type { createWorkRepository } from "./work-repository.server";
import { MaintenanceError, type WorkLease } from "./maintenance-types";
type Options = {
  source?: "contract_fixture" | "provider";
  targets: readonly OwnerContext[];
  work: ReturnType<typeof createWorkRepository>;
  reconcile: (ctx: OwnerContext, id: string, signal: AbortSignal) => Promise<{
    state: string;
    requiresManualReview: boolean;
  }>;
  observe: (ctx: OwnerContext, id: string, signal: AbortSignal) => Promise<unknown>;
};
export function createDueReconciler(options: Options) {
  const source = options.source, targets = options.targets.map(target => Object.freeze({ ...target }));
  return { async runDue() {
      if (source !== "contract_fixture")
        throw new MaintenanceError("disabled");
      if (targets.length > 100)
        throw new MaintenanceError("invalid_request");
      const controller = new AbortController(), signal = controller.signal, summary = { claimed: 0, completed: 0, failed: 0, timedOut: false };
      const timeout = setTimeout(() => controller.abort(), 30000);
      let rejectBudget!: (error: MaintenanceError) => void;
      const deadline = new Promise<never>((_resolve, reject) => { rejectBudget = reject; });
      const abort = () => rejectBudget(new MaintenanceError("unavailable"));
      signal.addEventListener("abort", abort, { once: true });
      async function within<T>(run: () => Promise<T>): Promise<T> {
        if (signal.aborted)
          throw new MaintenanceError("unavailable");
        const value = await Promise.race([run(), deadline]);
        if (signal.aborted)
          throw new MaintenanceError("unavailable");
        return value;
      }
      async function prepare(ctx: OwnerContext) {
        let expired = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const elapsed = new Promise<{
          kind: "failed";
        }>((resolve) => { timer = setTimeout(() => { expired = true; resolve({ kind: "failed" }); }, 5000); });
        const prepared = (async () => {
          await options.work.seed(ctx);
          if (expired || signal.aborted)
            return { kind: "failed" as const };
          const priority = await options.work.priority(ctx);
          if (expired || signal.aborted)
            return { kind: "failed" as const };
          return priority ? { kind: "ready" as const, ctx, attempts: priority.attempts } : { kind: "empty" as const };
        })().catch(() => ({ kind: "failed" as const }));
        try {
          return await Promise.race([prepared, elapsed]);
        }
        finally {
          clearTimeout(timer);
        }
      }
      try {
        const prepared = await within(() => Promise.all(targets.map(prepare)));
        summary.failed += prepared.filter(p => p.kind === "failed").length;
        const ready = prepared.filter((p): p is {
          kind: "ready";
          ctx: OwnerContext;
          attempts: number;
        } => p.kind === "ready").sort((a, b) => a.attempts - b.attempts || a.ctx.accountId.localeCompare(b.ctx.accountId));
        for (const { ctx } of ready) {
          if (signal.aborted) {
            summary.timedOut = true;
            break;
          }
          if (summary.claimed >= 10)
            break;
          let job: WorkLease | null = null;
          try {
            job = await within(() => options.work.claim(ctx));
            if (!job)
              continue;
            const lease = job;
            summary.claimed++;
            const status = await within(() => options.reconcile(ctx, lease.intentId, signal));
            if (["COMPLETE", "FAILED", "CANCELED"].includes(status.state) && !status.requiresManualReview)
              await within(() => options.observe(ctx, lease.intentId, signal));
            if (await within(() => options.work.finish(ctx, lease.id, lease.token)))
              summary.completed++;
            else
              summary.failed++;
          }
          catch {
            if (signal.aborted) {
              summary.timedOut = true;
              break;
            }
            summary.failed++;
            if (job) {
              const lease = job;
              try {
                await within(() => options.work.finish(ctx, lease.id, lease.token));
              }
              catch {
                if (signal.aborted) {
                  summary.timedOut = true;
                  break;
                }
              }
            }
          }
        }
        return Object.freeze(summary);
      }
      catch {
        if (signal.aborted)
          summary.timedOut = true;
        else
          summary.failed++;
        return Object.freeze(summary);
      }
      finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      }
    } };
}
