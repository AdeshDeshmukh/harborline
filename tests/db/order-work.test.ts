import { expect, test } from "vitest";
import { admin, db, clock, approved, setup, advance } from "../fixtures/order-database";
import { createWorkRepository } from "../../src/features/orders/work-repository.server";
const work = createWorkRepository(db, { clock, fixtureMode: true, fixtureWorkersEnabled: true });
test("concurrent workers claim one durable job and a fresh token after lease expiry", async () => {
  const d = await approved();
  await work.seed(d.owner);
  const claims = await Promise.all(Array.from({ length: 10 }, () => work.claim(d.owner)));
  expect(claims.filter(Boolean)).toHaveLength(1);
  const first = claims.find(Boolean)!;
  expect(first).toMatchObject({ intentId: d.command.intentId, attempts: 1 });
  advance(59999);
  expect(await work.claim(d.owner)).toBeNull();
  advance(1);
  const next = await work.claim(d.owner);
  expect(next?.token).not.toBe(first.token);
  expect(next?.attempts).toBe(2);
  expect(await work.finish(d.owner, first.id, first.token)).toBe(false);
  expect(await work.finish(d.owner, next!.id, next!.token)).toBe(true);
});
test("backoff persists across repository instances and is earliest-due rather than immediate retry", async () => {
  const d = await approved();
  await work.seed(d.owner);
  for (const delay of [5000, 10000, 30000, 60000, 60000]) {
    const job = await work.claim(d.owner);
    expect(job).not.toBeNull();
    expect(await work.finish(d.owner, job!.id, job!.token)).toBe(true);
    advance(delay - 1);
    expect(await work.claim(d.owner)).toBeNull();
    advance(1);
  }
  expect(await createWorkRepository(db, { clock, fixtureMode: true, fixtureWorkersEnabled: true }).claim(d.owner)).not.toBeNull();
});
test("unsigned reviews and default-disabled controls cannot schedule recovery", async () => {
  const d = await setup();
  expect(await work.seed(d.owner)).toBeNull();
  await expect(createWorkRepository(db, { clock }).seed(d.owner)).rejects.toMatchObject({ code: "disabled" });
});
test("another owner cannot finish a claimed lease", async () => {
  const d = await approved(), other = await approved();
  await work.seed(d.owner);
  const job = await work.claim(d.owner);
  expect(await work.finish(other.owner, job!.id, job!.token)).toBe(false);
});
test("a released operation stops the job instead of polling a replacement slot", async () => {
  const d = await approved();
  await work.seed(d.owner);
  const job = await work.claim(d.owner);
  await admin.query("UPDATE harborline.gateway_accounts SET active_operation_id=NULL WHERE id=$1", [d.owner.accountId]);
  expect(await work.finish(d.owner, job!.id, job!.token)).toBe(true);
  advance(60000);
  expect(await work.claim(d.owner)).toBeNull();
  expect((await admin.query("SELECT stopped FROM harborline.recovery_work WHERE id=$1", [job!.id])).rows).toEqual([{ stopped: true }]);
});
test("a suppressed lease write cannot return a token that was never persisted", async () => {
  const d = await approved();
  await work.seed(d.owner);
  await admin.query("CREATE FUNCTION harborline.skip_work() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL;END $$;CREATE TRIGGER skip_work BEFORE UPDATE ON harborline.recovery_work FOR EACH ROW EXECUTE FUNCTION harborline.skip_work()");
  try {
    await expect(work.claim(d.owner)).rejects.toMatchObject({ code: "conflict" });
  }
  finally {
    await admin.query("DROP TRIGGER skip_work ON harborline.recovery_work;DROP FUNCTION harborline.skip_work()");
  }
});
test("a fresh worker recovers persisted pending work and observes terminal cash without releasing", async () => {
  const { createOrderReconciler } = await import("../../src/features/orders/reconcile.server"), { createOrderRecoveryAdapter } = await import("../../src/integrations/truemarkets/recovery.server");
  const { createSettlementRepository } = await import("../../src/features/orders/settlement-repository.server"), { createSettlementObserver } = await import("../../src/features/orders/settlement.server"), { createDueReconciler } = await import("../../src/features/orders/reconcile-due.server");
  const { recovery, order } = await import("../fixtures/order-database");
  const { SOLANA_USDC_MINT } = await import("../../src/integrations/truemarkets/read-types");
  const { assets } = await import("../fixtures/investment-review");
  const d = await approved();
  let complete = false;
  const requests: unknown[] = [];
  const reconcile = createOrderReconciler({ source: "contract_fixture", repository: recovery, adapter: createOrderRecoveryAdapter({ async request(method, path, options) { requests.push({ method, path, userId: options.userId }); return order(d, complete ? { status: "complete", executed_qty: "0.5", leaves_qty: "0", fee: "0.5" } : {}); } }, "contract_fixture") });
  const settlement = createSettlementRepository(db, { clock, fixtureMode: true });
  const observer = createSettlementObserver({ source: "contract_fixture", repository: settlement, clock, transport: { async request(method, path, options) { requests.push({ method, path, userId: options.userId }); return { data: [{ asset_id: assets.cash.id, address: SOLANA_USDC_MINT, chain: "solana", venue: "defi", symbol: "USDC", stable: true, tradeable: false, decimals: 6, available: "1899.5", total: "1899.5", held: "0" }] }; } } });
  const worker = () => createDueReconciler({ source: "contract_fixture", targets: [d.owner], work: createWorkRepository(db, { clock, fixtureMode: true, fixtureWorkersEnabled: true }), reconcile: (ctx, id, signal) => reconcile.reconcileOrder(ctx, id, { signal }), observe: observer.observe });
  expect(await worker().runDue()).toMatchObject({ completed: 1, failed: 0 });
  complete = true;
  advance(5000);
  expect(await worker().runDue()).toMatchObject({ completed: 1, failed: 0 });
  expect(await recovery.current(d.owner, d.command.intentId)).toMatchObject({ state: "COMPLETE", slotHeld: true });
  expect((await admin.query("SELECT * FROM harborline.settlement_balances WHERE account_id=$1", [d.owner.accountId])).rows).toHaveLength(1);
  expect((await admin.query("SELECT * FROM harborline.settlement_verifications WHERE account_id=$1", [d.owner.accountId])).rows).toEqual([]);
  expect(requests).toHaveLength(3);
  expect(requests.every(r => (r as {
    method: string;
  }).method === "GET")).toBe(true);
  expect((await admin.query("SELECT * FROM harborline.execution_dispatches WHERE account_id=$1", [d.owner.accountId])).rows).toEqual([]);
});
test("clock reversal cannot complete a lease with a backdated retry schedule", async () => {
  const d = await approved();
  await work.seed(d.owner);
  const job = await work.claim(d.owner);
  advance(-1);
  await expect(work.finish(d.owner, job!.id, job!.token)).rejects.toMatchObject({ code: "unavailable" });
});
test("work records enforce owner visibility and restrict mutable identity and signer access", async () => {
  const d = await approved(), other = await setup();
  await work.seed(d.owner);
  const client = await admin.connect();
  try {
    await client.query("BEGIN;SET LOCAL ROLE harborline_app");
    await client.query("SELECT set_config('harborline.owner_id',$1,true)", [other.owner.ownerId]);
    expect((await client.query("SELECT * FROM harborline.recovery_work")).rows).toEqual([]);
    await client.query("ROLLBACK;BEGIN;SET LOCAL ROLE harborline_app");
    await client.query("SELECT set_config('harborline.owner_id',$1,true)", [d.owner.ownerId]);
    expect((await client.query("SELECT * FROM harborline.recovery_work")).rows).toHaveLength(1);
    await expect(client.query("UPDATE harborline.recovery_work SET account_id=account_id")).rejects.toMatchObject({ code: "42501" });
  }
  finally {
    await client.query("ROLLBACK");
    client.release();
  }
  for (const role of ["public", "harborline_key_store"])
    expect((await admin.query("SELECT has_table_privilege($1,'harborline.recovery_work','SELECT') AS read", [role])).rows).toEqual([{ read: false }]);
});
