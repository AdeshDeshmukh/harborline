import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createDueReconciler } from "../src/features/orders/reconcile-due.server";
import { createReconciliationHandler } from "../src/features/orders/worker-handler.server";
import type { OwnerContext } from "../src/features/identity/access.server";
const owner = { ownerId: "11111111-1111-4111-8111-111111111111", accountId: "22222222-2222-4222-8222-222222222222", externalRefId: "fixture", email: "test@example.invalid" } as OwnerContext;
afterEach(() => vi.useRealTimers());
function fixture(count = 1) { let starts = 0, balances = 0, finishes = 0; return { targets: Array.from({ length: count }, () => owner), work: { async priority() { return { attempts: 0 }; }, async seed() { return "job"; }, async claim() { return { id: "job", intentId: "intent", token: "token", attempts: 1 }; }, async finish() { finishes++; return true; } }, async reconcile() { starts++; return { state: "COMPLETE", requiresManualReview: false }; }, async observe() { balances++; }, stats: () => ({ starts, balances, finishes }) }; }
test("one invocation starts at most ten reads and observes balances without automatic release", async () => {
  const f = fixture(15), worker = createDueReconciler({ source: "contract_fixture", ...f });
  expect(await worker.runDue()).toMatchObject({ claimed: 10, completed: 10, failed: 0, timedOut: false });
  expect(f.stats()).toEqual({ starts: 10, balances: 10, finishes: 10 });
});
test("the thirty-second budget aborts a hung dependency and starts no further work", async () => {
  vi.useFakeTimers();
  const f = fixture(2);
  let signal: AbortSignal | undefined;
  const worker = createDueReconciler({ source: "contract_fixture", ...f, reconcile: async (_ctx, _id, s) => { signal = s; return new Promise(() => { }); } });
  const result = worker.runDue().then(value => ({ value }), error => ({ error }));
  await vi.advanceTimersByTimeAsync(30000);
  expect(await result).toMatchObject({ value: { claimed: 1, completed: 0, timedOut: true } });
  expect(signal?.aborted).toBe(true);
  expect(f.stats().finishes).toBe(0);
});
test("provider mode and default composition cannot begin a worker", async () => {
  const f = fixture();
  await expect(createDueReconciler({ ...f, source: "provider" }).runDue()).rejects.toMatchObject({ code: "disabled" });
  expect(f.stats().starts).toBe(0);
});
const secret = "a".repeat(48), request = (query = "", auth = "Bearer " + secret) => new Request("https://local.test/api/internal/reconcile" + query, { headers: { authorization: auth } });
test("invalid secrets and query-supplied account selectors cannot cause work", async () => {
  let runs = 0;
  const handler = createReconciliationHandler({ secret: () => secret, run: async () => { runs++; return { claimed: 0, completed: 0, failed: 0, timedOut: false }; } });
  expect((await handler(request("", "Bearer bad"))).status).toBe(401);
  expect((await handler(request("?ownerId=someone"))).status).toBe(400);
  expect(runs).toBe(0);
});
test("the default route is hard disabled even with a valid secret", async () => {
  const handler = createReconciliationHandler({ secret: () => secret });
  expect((await handler(request())).status).toBe(503);
});
test("worker response exposes aggregate counts only and HEAD does not run work", async () => {
  let runs = 0;
  const handler = createReconciliationHandler({ secret: () => secret, run: async () => { runs++; return { claimed: 1, completed: 1, failed: 0, timedOut: false, private: "hidden" }; } });
  const result = await handler(request());
  expect(result.headers.get("cache-control")).toContain("no-store");
  expect(JSON.stringify(await result.json())).not.toContain("hidden");
  expect((await handler(new Request("https://local.test/api/internal/reconcile", { method: "HEAD", headers: { authorization: "Bearer " + secret } }))).status).toBe(405);
  expect(runs).toBe(1);
});
test("the actual runtime route remains disabled with correct authorization and HEAD does no work", async () => {
  const { GET, HEAD } = await import("../src/app/api/internal/reconcile/route");
  vi.stubEnv("CRON_SECRET", secret);
  try {
    expect((await GET(request())).status).toBe(503);
    expect((await HEAD(new Request("https://local.test/api/internal/reconcile", { method: "HEAD", headers: { authorization: "Bearer " + secret } }))).status).toBe(405);
  }
  finally {
    vi.unstubAllEnvs();
  }
});
test("fresh worker instances fairly reach target eleven after a full first batch", async () => {
  const targets = Array.from({ length: 11 }, (_, i) => ({ ...owner, accountId: String(i).padStart(12, "0") } as OwnerContext)), attempts = new Map<string, number>(), seen: string[] = [];
  const work = { async seed(ctx: OwnerContext) { return ctx.accountId; }, async priority(ctx: OwnerContext) { return { attempts: attempts.get(ctx.accountId) ?? 0 }; }, async claim(ctx: OwnerContext) { const n = (attempts.get(ctx.accountId) ?? 0) + 1; attempts.set(ctx.accountId, n); return { id: ctx.accountId, intentId: ctx.accountId, token: "token", attempts: n }; }, async finish() { return true; } };
  for (let i = 0; i < 3; i++)
    await createDueReconciler({ source: "contract_fixture", targets, work, async reconcile(ctx) { seen.push(ctx.accountId); return { state: "PENDING", requiresManualReview: false }; }, async observe() { } }).runDue();
  expect(seen).toContain(targets[10].accountId);
});
test("a repeatedly hung first target cannot monopolize fresh invocations", async () => {
  vi.useFakeTimers();
  const targets = [owner, { ...owner, accountId: "other" } as OwnerContext], attempts = new Map<string, number>(), seen: string[] = [];
  const work = { async seed() { return "job"; }, async priority(ctx: OwnerContext) { return { attempts: attempts.get(ctx.accountId) ?? 0 }; }, async claim(ctx: OwnerContext) { const n = (attempts.get(ctx.accountId) ?? 0) + 1; attempts.set(ctx.accountId, n); return { id: ctx.accountId, intentId: ctx.accountId, token: "token", attempts: n }; }, async finish() { return true; } };
  const worker = () => createDueReconciler({ source: "contract_fixture", targets, work, async reconcile(ctx) { seen.push(ctx.accountId); if (ctx.accountId === owner.accountId)
      return new Promise(() => { }); return { state: "PENDING", requiresManualReview: false }; }, async observe() { } });
  for (let i = 0; i < 2; i++) {
    const task = worker().runDue().then(value => ({ value }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(30000);
    await task;
  }
  expect(seen).toContain("other");
});
test("a stuck account preparation does not consume the whole batch budget", async () => {
  vi.useFakeTimers();
  const f = fixture(2), targets = [owner, { ...owner, accountId: "other" } as OwnerContext];
  const worker = createDueReconciler({ source: "contract_fixture", ...f, targets, work: { ...f.work, async seed(ctx) { if (ctx.accountId === owner.accountId)
        return new Promise(() => { }); return "job"; } } });
  const task = worker.runDue().then(value => ({ value }), error => ({ error }));
  await vi.advanceTimersByTimeAsync(30000);
  expect(await task).toMatchObject({ value: { completed: 1, timedOut: false } });
});
