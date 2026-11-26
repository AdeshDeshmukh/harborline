import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { admin, db, clock, approved, completed, setup, recovery, order, responseOf, advance } from "../fixtures/order-database";
import { createSettlementRepository } from "../../src/features/orders/settlement-repository.server";
import { SOLANA_USDC_MINT } from "../../src/integrations/truemarkets/read-types";
const operatorId = randomUUID();
const repo = createSettlementRepository(db, { clock, fixtureMode: true, fixtureClearanceEnabled: true, operatorId, allowedOperatorIds: [operatorId] });
const body = (cashId: string, available = "1899.5") => ({ data: [{ asset_id: cashId, address: SOLANA_USDC_MINT, chain: "solana", venue: "defi", symbol: "USDC", stable: true, tradeable: false, decimals: 6, available, total: available, held: "0" }] });
async function observed() { const d = await completed(), basis = await repo.beginBalanceRead(d.owner, d.command.intentId), observation = await repo.recordBalance(d.owner, basis, { source: "contract_fixture", observedAt: clock().toISOString(), body: body(basis.cashId) }); return { ...d, basis, observation }; }
function proof(d: Awaited<ReturnType<typeof observed>>) { return { intentId: d.command.intentId, observationId: d.observation.id, requestKey: randomUUID(), actualDebit: "100.5", interveningCredits: "0", interveningDebits: "0", references: { order: "fixture:" + d.review.providerOrderId, wallet: "fixture:wallet", balance: "fixture:" + d.observation.id, activity: "fixture:activity" } }; }
test("terminal status keeps its slot until an operator's coherent evidence is committed", async () => {
  const d = await observed();
  expect((await recovery.current(d.owner, d.command.intentId)).slotHeld).toBe(true);
  const p = proof(d), result = await repo.clear(d.owner, p);
  expect(result).toMatchObject({ intentId: d.command.intentId, method: "manual", source: "contract_fixture", slotReleased: true });
  expect(await repo.clear(d.owner, p)).toEqual(result);
  expect(await recovery.current(d.owner, d.command.intentId)).toMatchObject({ slotHeld: false, settlementVerified: true });
  expect((await admin.query("SELECT * FROM harborline.settlement_verifications WHERE intent_id=$1", [d.command.intentId])).rows).toHaveLength(1);
});
test("pending orders and unconflicted terminal evidence missing actual amounts cannot create a basis", async () => {
  const d = await approved();
  await expect(repo.beginBalanceRead(d.owner, d.command.intentId)).rejects.toMatchObject({ code: "conflict" });
  const ticket = await recovery.begin(d.owner, d.command.intentId);
  await recovery.record(d.owner, ticket.id, responseOf(order(d, { status: "complete", executed_qty: null, leaves_qty: "0" })));
  await expect(repo.beginBalanceRead(d.owner, d.command.intentId)).rejects.toMatchObject({ code: "conflict" });
});
test("provider mapping or intent revision changing while balance is fetched fences the observation", async () => {
  const d = await completed(), basis = await repo.beginBalanceRead(d.owner, d.command.intentId);
  await admin.query("UPDATE harborline.gateway_accounts SET provider_user_id=$2 WHERE id=$1", [d.owner.accountId, randomUUID()]);
  await expect(repo.recordBalance(d.owner, basis, { source: "contract_fixture", observedAt: clock().toISOString(), body: body(basis.cashId) })).rejects.toMatchObject({ code: "conflict" });
});
test("stale balances and unexplained cash differences retain the operation", async () => {
  const d = await observed();
  advance(15001);
  await expect(repo.clear(d.owner, proof(d))).rejects.toMatchObject({ code: "conflict" });
  const next = await observed();
  await expect(repo.clear(next.owner, { ...proof(next), actualDebit: "100" })).rejects.toMatchObject({ code: "conflict" });
  expect((await recovery.current(next.owner, next.command.intentId)).slotHeld).toBe(true);
});
test("another owner, denied operator and disabled clearance cannot clear", async () => {
  const d = await observed(), other = await setup(), p = proof(d);
  await expect(repo.clear(other.owner, p)).rejects.toMatchObject({ code: "not_found" });
  await expect(createSettlementRepository(db, { clock, fixtureMode: true, fixtureClearanceEnabled: true, operatorId: randomUUID(), allowedOperatorIds: [operatorId] }).clear(d.owner, p)).rejects.toMatchObject({ code: "disabled" });
  await expect(createSettlementRepository(db, { clock, fixtureMode: true }).clear(d.owner, p)).rejects.toMatchObject({ code: "disabled" });
});
test("conflicting terminal history remains held for investigation", async () => {
  const d = await completed(), ticket = await recovery.begin(d.owner, d.command.intentId);
  await recovery.record(d.owner, ticket.id, responseOf(order(d, { status: "failed", executed_qty: null, leaves_qty: null, fee: null })));
  await expect(repo.beginBalanceRead(d.owner, d.command.intentId)).rejects.toMatchObject({ code: "conflict" });
});
test("audit failure rolls back verification and slot release together", async () => {
  const d = await observed();
  await admin.query("CREATE FUNCTION harborline.fail_clearance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='settlement_manually_verified' THEN RAISE EXCEPTION 'private';END IF;RETURN NEW;END $$;CREATE TRIGGER fail_clearance BEFORE INSERT ON harborline.audit_events FOR EACH ROW EXECUTE FUNCTION harborline.fail_clearance()");
  try {
    await expect(repo.clear(d.owner, proof(d))).rejects.toMatchObject({ code: "unavailable" });
    expect((await recovery.current(d.owner, d.command.intentId)).slotHeld).toBe(true);
    expect((await admin.query("SELECT * FROM harborline.settlement_verifications WHERE intent_id=$1", [d.command.intentId])).rows).toEqual([]);
  }
  finally {
    await admin.query("DROP TRIGGER fail_clearance ON harborline.audit_events;DROP FUNCTION harborline.fail_clearance()");
  }
});
test("clearance installs the reconciled planning baseline so pre-trade cash cannot be reused", async () => {
  const d = await observed();
  await repo.clear(d.owner, proof(d));
  const latest = (await admin.query("SELECT id,available::text AS available FROM harborline.balance_snapshots WHERE account_id=$1 ORDER BY sequence DESC LIMIT 1", [d.owner.accountId])).rows[0];
  expect(latest.available).toBe("1899.500000000000000000");
  expect((await admin.query("SELECT baseline_balance_id FROM harborline.settlement_verifications WHERE intent_id=$1", [d.command.intentId])).rows).toEqual([{ baseline_balance_id: latest.id }]);
});
test("a provider cash hold prevents manual clearance despite matching available arithmetic", async () => {
  const d = await completed(), basis = await repo.beginBalanceRead(d.owner, d.command.intentId), raw = body(basis.cashId);
  raw.data[0].held = "100";
  raw.data[0].total = "1999.5";
  const observation = await repo.recordBalance(d.owner, basis, { source: "contract_fixture", observedAt: clock().toISOString(), body: raw });
  const entry = { ...d, basis, observation };
  await expect(repo.clear(d.owner, proof(entry))).rejects.toMatchObject({ code: "conflict" });
});
test("clearance replay cannot release the next operation", async () => {
  const d = await observed(), p = proof(d);
  await repo.clear(d.owner, p);
  const { intents } = await import("../fixtures/order-database"), next = await intents.claim(d.owner, { ...d.request, requestKey: randomUUID() });
  await repo.clear(d.owner, p);
  expect((await admin.query("SELECT active_operation_id FROM harborline.gateway_accounts WHERE id=$1", [d.owner.accountId])).rows).toEqual([{ active_operation_id: next.intent.id }]);
  await expect(repo.clear(d.owner, { ...p, requestKey: randomUUID() })).rejects.toMatchObject({ code: "conflict" });
});
test("a newer observation, revised terminal read and future timestamp each fence stale proof", async () => {
  const d = await observed();
  const newerCapture = await repo.beginBalanceRead(d.owner, d.command.intentId);
  await repo.recordBalance(d.owner, newerCapture, { source: "contract_fixture", observedAt: clock().toISOString(), body: body(d.basis.cashId) });
  await expect(repo.clear(d.owner, proof(d))).rejects.toMatchObject({ code: "conflict" });
  const ticket = await recovery.begin(d.owner, d.command.intentId);
  await recovery.record(d.owner, ticket.id, responseOf(order(d, { status: "complete", executed_qty: "0.5", leaves_qty: "0", fee: "0.5" })));
  await expect(repo.recordBalance(d.owner, d.basis, { source: "contract_fixture", observedAt: clock().toISOString(), body: body(d.basis.cashId) })).rejects.toMatchObject({ code: "conflict" });
  const basis = await repo.beginBalanceRead(d.owner, d.command.intentId);
  await expect(repo.recordBalance(d.owner, basis, { source: "contract_fixture", observedAt: new Date(clock().getTime() + 1).toISOString(), body: body(basis.cashId) })).rejects.toMatchObject({ code: "conflict" });
});
test("exactly fifteen-second-old coherent proof is accepted", async () => {
  const d = await observed();
  advance(15000);
  expect(await repo.clear(d.owner, proof(d))).toMatchObject({ slotReleased: true });
});
test("a different unresolved operation prevents clearance despite coherent arithmetic", async () => {
  const d = await observed();
  await admin.query("INSERT INTO harborline.investment_intents(id,account_id,request_key,request_hash,operation_kind,asset_id,requested_qty,qty_unit,state,policy_revision,calculation_id,preparation_safety,effects_possible,created_at,updated_at) SELECT $2,account_id,$3,repeat('f',64),operation_kind,asset_id,requested_qty,qty_unit,'UNKNOWN',policy_revision,calculation_id,preparation_safety,true,created_at,updated_at FROM harborline.investment_intents WHERE id=$1", [d.command.intentId, randomUUID(), randomUUID()]);
  await expect(repo.clear(d.owner, proof(d))).rejects.toMatchObject({ code: "conflict" });
});
test("a partially filled failure can be reconciled using its actual debit", async () => {
  const d = await approved(), ticket = await recovery.begin(d.owner, d.command.intentId);
  await recovery.record(d.owner, ticket.id, responseOf(order(d, { status: "failed", executed_qty: "0.2", leaves_qty: "0.3", fee: "0.2", executed_vwap: "200" })));
  const basis = await repo.beginBalanceRead(d.owner, d.command.intentId), observation = await repo.recordBalance(d.owner, basis, { source: "contract_fixture", observedAt: clock().toISOString(), body: body(basis.cashId, "1959.8") });
  const entry = { ...d, readId: ticket.id, basis, observation };
  expect(await repo.clear(d.owner, { ...proof(entry), actualDebit: "40.2" })).toMatchObject({ slotReleased: true });
});
test("the maintenance runner binds the real owned operator action to its proof file", async () => {
  const { runManualCommand } = await import("../../scripts/record-manual-reconciliation.mjs"), { mkdtemp, writeFile, rm } = await import("node:fs/promises"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
  const d = await observed(), dir = await mkdtemp(join(tmpdir(), "harborline-clearance-"));
  try {
    const file = join(dir, "proof.json");
    await writeFile(file, JSON.stringify(proof(d)));
    expect(await runManualCommand(["--proof-file", file], { source: "contract_fixture", run: value => repo.clear(d.owner, value) })).toMatchObject({ exitCode: 0 });
    expect((await recovery.current(d.owner, d.command.intentId)).slotHeld).toBe(false);
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("settlement evidence is owner-isolated, append-only and denied to signer/public roles", async () => {
  const d = await observed(), other = await setup();
  await repo.clear(d.owner, proof(d));
  async function asOwner(query: string, ownerId: string) {
    const c = await admin.connect();
    try {
      await c.query("BEGIN;SET LOCAL ROLE harborline_app");
      await c.query("SELECT set_config('harborline.owner_id',$1,true)", [ownerId]);
      return await c.query(query);
    }
    finally {
      await c.query("ROLLBACK");
      c.release();
    }
  }
  for (const table of ["settlement_balance_reads", "settlement_balances", "settlement_verifications"]) {
    expect((await asOwner(`SELECT * FROM harborline.${table}`, other.owner.ownerId)).rows).toEqual([]);
    for (const query of [`UPDATE harborline.${table} SET source='contract_fixture'`, `DELETE FROM harborline.${table}`])
      await expect(asOwner(query, d.owner.ownerId)).rejects.toMatchObject({ code: "42501" });
    for (const role of ["public", "harborline_key_store"])
      expect((await admin.query("SELECT has_table_privilege($1,$2,'SELECT') AS read,has_table_privilege($1,$2,'INSERT') AS write", [role, "harborline." + table])).rows).toEqual([{ read: false, write: false }]);
  }
});
test("a still-running original execution prevents clearance and its later conflict stays visible", async () => {
  const { createFixtureExecutionService } = await import("../../src/features/orders/execute.server"), { createExecutionRepository } = await import("../../src/features/orders/execution-repository.server"), { createOrderExecutionAdapter } = await import("../../src/integrations/truemarkets/execution.server"), { createReviewVault } = await import("../../src/features/orders/review-vault.server");
  const d = await approved();
  let entered!: () => void, release!: (value: unknown) => void;
  const started = new Promise<void>(r => { entered = r; }), pending = new Promise(r => { release = r; });
  const execution = createFixtureExecutionService({ source: "contract_fixture", execution: createExecutionRepository(db, { clock, fixtureMode: true, fixtureExecutionEnabled: true }), vault: createReviewVault(Buffer.alloc(32, 9), 1), signer: { async stamp() { return ["fixtureStamp"]; } }, adapter: createOrderExecutionAdapter({ async request() { entered(); return pending; } }) });
  const task = execution.execute(d.owner, d.command).then(value => ({ value }), error => ({ error }));
  await started;
  const ticket = await recovery.begin(d.owner, d.command.intentId);
  await recovery.record(d.owner, ticket.id, responseOf(order(d, { status: "complete", executed_qty: "0.5", leaves_qty: "0", fee: "0.5", executed_vwap: "200" })));
  const basis = await repo.beginBalanceRead(d.owner, d.command.intentId).then(value => ({ value }), error => ({ error }));
  release({ status: "failed" });
  await task;
  expect(basis).toMatchObject({ error: { code: "conflict" } });
  expect(await recovery.current(d.owner, d.command.intentId)).toMatchObject({ slotHeld: true, requiresManualReview: true });
});
test("the newest unfinished order read blocks clearance but a completed newer ticket supersedes a crashed read", async () => {
  const d = await observed();
  await recovery.begin(d.owner, d.command.intentId);
  await expect(repo.clear(d.owner, proof(d))).rejects.toMatchObject({ code: "conflict" });
  const latest = await recovery.begin(d.owner, d.command.intentId);
  await recovery.record(d.owner, latest.id, responseOf(order(d, { status: "complete", executed_qty: "0.5", leaves_qty: "0", fee: "0.5", executed_vwap: "200" })));
  const basis = await repo.beginBalanceRead(d.owner, d.command.intentId), observation = await repo.recordBalance(d.owner, basis, { source: "contract_fixture", observedAt: clock().toISOString(), body: body(basis.cashId) });
  expect(await repo.clear(d.owner, proof({ ...d, basis, observation }))).toMatchObject({ slotReleased: true });
});
test.each([0, 1])("older balance request cannot overwrite a newer capture, including timestamp ties (%i ms)", async (gap) => {
  const d = await completed(), older = await repo.beginBalanceRead(d.owner, d.command.intentId);
  advance(gap);
  const newer = await repo.beginBalanceRead(d.owner, d.command.intentId);
  const observation = await repo.recordBalance(d.owner, newer, { source: "contract_fixture", observedAt: clock().toISOString(), body: body(newer.cashId, "1900.5") });
  await expect(repo.recordBalance(d.owner, older, { source: "contract_fixture", observedAt: new Date(clock().getTime() - gap).toISOString(), body: body(older.cashId) })).rejects.toMatchObject({ code: "conflict" });
  expect(await repo.clear(d.owner, { ...proof({ ...d, basis: newer, observation }), interveningCredits: "1" })).toMatchObject({ slotReleased: true });
});
test("chronologically pre-approval evidence cannot become the post-trade baseline", async () => {
  const d = await approved();
  advance(-1000);
  const ticket = await recovery.begin(d.owner, d.command.intentId);
  await recovery.record(d.owner, ticket.id, responseOf(order(d, { status: "complete", executed_qty: "0.5", leaves_qty: "0", fee: "0.5", executed_vwap: "200" })));
  await expect(repo.beginBalanceRead(d.owner, d.command.intentId)).rejects.toMatchObject({ code: "conflict" });
  advance(1000);
  const latest = await recovery.begin(d.owner, d.command.intentId);
  await recovery.record(d.owner, latest.id, responseOf(order(d, { status: "complete", executed_qty: "0.5", leaves_qty: "0", fee: "0.5", executed_vwap: "200" })));
  expect(await repo.beginBalanceRead(d.owner, d.command.intentId)).toMatchObject({ intentId: d.command.intentId });
});
test("a suppressed clearance audit rolls back the baseline, verification and release", async () => {
  const d = await observed(), before = (await admin.query("SELECT count(*)::int AS n FROM harborline.balance_snapshots WHERE account_id=$1", [d.owner.accountId])).rows;
  await admin.query("CREATE FUNCTION harborline.skip_clearance_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='settlement_manually_verified' THEN RETURN NULL;END IF;RETURN NEW;END $$;CREATE TRIGGER skip_clearance_audit BEFORE INSERT ON harborline.audit_events FOR EACH ROW EXECUTE FUNCTION harborline.skip_clearance_audit()");
  try {
    await expect(repo.clear(d.owner, proof(d))).rejects.toMatchObject({ code: "conflict" });
    expect((await recovery.current(d.owner, d.command.intentId)).slotHeld).toBe(true);
    expect((await admin.query("SELECT count(*)::int AS n FROM harborline.balance_snapshots WHERE account_id=$1", [d.owner.accountId])).rows).toEqual(before);
  }
  finally {
    await admin.query("DROP TRIGGER skip_clearance_audit ON harborline.audit_events;DROP FUNCTION harborline.skip_clearance_audit()");
  }
});
test("a supported 128-character stored order can be manually reconciled", async () => {
  const providerOrderId = "o".repeat(128), d = await completed(providerOrderId);
  expect(d.review.providerOrderId).toBe(providerOrderId);
  const basis = await repo.beginBalanceRead(d.owner, d.command.intentId), observation = await repo.recordBalance(d.owner, basis, { source: "contract_fixture", observedAt: basis.balanceStartedAt, body: body(basis.cashId) });
  expect(await repo.clear(d.owner, proof({ ...d, basis, observation }))).toMatchObject({ slotReleased: true });
});
test("an unfinished newest balance capture blocks release but a newer complete capture supersedes it", async () => {
  const d = await observed();
  await repo.beginBalanceRead(d.owner, d.command.intentId);
  await expect(repo.clear(d.owner, proof(d))).rejects.toMatchObject({ code: "conflict" });
  const basis = await repo.beginBalanceRead(d.owner, d.command.intentId), observation = await repo.recordBalance(d.owner, basis, { source: "contract_fixture", observedAt: basis.balanceStartedAt, body: body(basis.cashId) });
  expect(await repo.clear(d.owner, proof({ ...d, basis, observation }))).toMatchObject({ slotReleased: true });
});
test("verification cannot predate the stored completion of its balance read", async () => {
  const d = await completed(), basis = await repo.beginBalanceRead(d.owner, d.command.intentId);
  advance(10);
  const observation = await repo.recordBalance(d.owner, basis, { source: "contract_fixture", observedAt: basis.balanceStartedAt, body: body(basis.cashId) });
  advance(-1);
  await expect(repo.clear(d.owner, proof({ ...d, basis, observation }))).rejects.toMatchObject({ code: "conflict" });
});
