import "server-only";
import { and, eq, lte, or, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { getDatabase } from "../../server/db";
import { investmentIntents, orderApprovals, recoveryWork } from "../../server/db/schema";
import type { OwnerContext } from "../identity/access.server";
import { MaintenanceError, maintenanceTime, type WorkLease } from "./maintenance-types";
import { appendMaintenanceAudit, maintenanceTransaction } from "./maintenance-transaction.server";
export function createWorkRepository(database: ReturnType<typeof getDatabase>, options: {
  clock: () => Date;
  fixtureMode?: boolean;
  fixtureWorkersEnabled?: boolean;
}) {
  const transaction = maintenanceTransaction(database);
  function enabled() {
    if (options.fixtureMode !== true || options.fixtureWorkersEnabled !== true)
      throw new MaintenanceError("disabled");
  }
  return {
    async seed(ctx: OwnerContext): Promise<string | null> {
      enabled();
      return transaction(ctx, async (tx, a) => {
        if (!a.activeOperationId)
          return null;
        const [i] = await tx.select().from(investmentIntents).where(and(eq(investmentIntents.id, a.activeOperationId), eq(investmentIntents.accountId, a.id)));
        if (!i || !i.effectsPossible || i.preparationSafety !== "contract_fixture" || !i.providerOrderId || !["SUBMITTING", "PENDING", "UNKNOWN", "MANUAL_REVIEW", "COMPLETE", "FAILED", "CANCELED"].includes(i.state))
          return null;
        const [approval] = await tx.select({ id: orderApprovals.id }).from(orderApprovals).where(and(eq(orderApprovals.intentId, i.id), eq(orderApprovals.accountId, a.id), eq(orderApprovals.source, "contract_fixture")));
        if (!approval)
          return null;
        enabled();
        const now = maintenanceTime(options.clock);
        const [created] = await tx.insert(recoveryWork).values({ accountId: a.id, intentId: i.id, source: "contract_fixture", nextCheckAt: now, updatedAt: now }).onConflictDoNothing({ target: recoveryWork.intentId }).returning({ id: recoveryWork.id });
        if (created) {
          await appendMaintenanceAudit(tx, { accountId: a.id, intentId: i.id, actorId: null, eventType: "recovery_work_scheduled", metadata: { source: "contract_fixture" }, occurredAt: now });
          return created.id;
        }
        const [existing] = await tx.select({ id: recoveryWork.id }).from(recoveryWork).where(and(eq(recoveryWork.accountId, a.id), eq(recoveryWork.intentId, i.id)));
        return existing?.id ?? null;
      });
    },
    async priority(ctx: OwnerContext): Promise<{
      attempts: number;
    } | null> {
      enabled();
      return transaction(ctx, async (tx, a) => {
        if (!a.activeOperationId)
          return null;
        const [job] = await tx.select({ attempts: recoveryWork.attempts }).from(recoveryWork).where(and(eq(recoveryWork.accountId, a.id), eq(recoveryWork.intentId, a.activeOperationId), eq(recoveryWork.stopped, false))).limit(1);
        return job ?? null;
      });
    },
    async claim(ctx: OwnerContext): Promise<WorkLease | null> {
      enabled();
      return transaction(ctx, async (tx, a) => {
        enabled();
        const now = maintenanceTime(options.clock);
        const [job] = await tx.select().from(recoveryWork).where(and(eq(recoveryWork.accountId, a.id), eq(recoveryWork.stopped, false), lte(recoveryWork.nextCheckAt, now), or(isNull(recoveryWork.leaseUntil), lte(recoveryWork.leaseUntil, now)))).for("update", { skipLocked: true }).limit(1);
        if (!job)
          return null;
        if (a.activeOperationId !== job.intentId) {
          await tx.update(recoveryWork).set({ stopped: true, leaseToken: null, leaseUntil: null, updatedAt: now }).where(eq(recoveryWork.id, job.id));
          return null;
        }
        const token = randomUUID(), attempts = job.attempts + 1;
        const changed = await tx.update(recoveryWork).set({ leaseToken: token, leaseUntil: new Date(now.getTime() + 60000), attempts, updatedAt: now }).where(eq(recoveryWork.id, job.id)).returning({ id: recoveryWork.id });
        if (changed.length !== 1)
          throw new MaintenanceError("conflict");
        await appendMaintenanceAudit(tx, { accountId: a.id, intentId: job.intentId, actorId: null, eventType: "recovery_work_claimed", metadata: { jobId: job.id, attempt: attempts, source: "contract_fixture" }, occurredAt: now });
        return { id: job.id, intentId: job.intentId, token, attempts };
      });
    },
    async finish(ctx: OwnerContext, id: string, token: string): Promise<boolean> {
      if (options.fixtureMode !== true)
        throw new MaintenanceError("disabled");
      return transaction(ctx, async (tx, a) => {
        const now = maintenanceTime(options.clock);
        const [job] = await tx.select().from(recoveryWork).where(and(eq(recoveryWork.id, id), eq(recoveryWork.accountId, a.id), eq(recoveryWork.leaseToken, token), sql`${recoveryWork.leaseUntil}>${now}`)).for("update");
        if (!job)
          return false;
        if (now < job.updatedAt)
          throw new MaintenanceError("unavailable");
        const [i] = await tx.select({ state: investmentIntents.state }).from(investmentIntents).where(and(eq(investmentIntents.id, job.intentId), eq(investmentIntents.accountId, a.id)));
        const delay = i && ["COMPLETE", "FAILED", "CANCELED"].includes(i.state) ? 60000 : [5000, 10000, 30000, 60000][Math.min(job.attempts - 1, 3)];
        const changed = await tx.update(recoveryWork).set({ leaseToken: null, leaseUntil: null, nextCheckAt: new Date(now.getTime() + delay), stopped: a.activeOperationId !== job.intentId, updatedAt: now }).where(and(eq(recoveryWork.id, id), eq(recoveryWork.leaseToken, token))).returning({ id: recoveryWork.id });
        if (changed.length !== 1)
          throw new MaintenanceError("conflict");
        await appendMaintenanceAudit(tx, { accountId: a.id, intentId: job.intentId, actorId: null, eventType: "recovery_work_finished", metadata: { jobId: id, source: "contract_fixture" }, occurredAt: now });
        return true;
      });
    },
  };
}
