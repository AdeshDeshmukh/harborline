import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createDatabase } from "../../src/server/db";
import { bootstrapAccount } from "../../src/features/accounts/repository.server";
import type { OwnerContext } from "../../src/features/identity/access.server";
import { createPlanningRepository } from "../../src/features/planning/repository.server";
import { createPlanningService } from "../../src/features/planning/service.server";
import { createCalculationStore } from "../../src/features/planning/snapshots.server";
import { createIntentRepository } from "../../src/features/orders/repository.server";
import { createReviewRepository } from "../../src/features/orders/reviews.server";
import { createReviewVault } from "../../src/features/orders/review-vault.server";
import { createApprovalRepository } from "../../src/features/orders/approvals.server";
import { createOrderReconciler } from "../../src/features/orders/reconcile.server";
import { createOrderRecoveryAdapter } from "../../src/integrations/truemarkets/recovery.server";
import { createFixtureExecutionService } from "../../src/features/orders/execute.server";
import { createExecutionRepository } from "../../src/features/orders/execution-repository.server";
import { createOrderExecutionAdapter } from "../../src/integrations/truemarkets/execution.server";
import { createRecoveryRepository } from "../../src/features/orders/recovery-repository.server";
import { normalizePreparationResponse } from "../../src/integrations/truemarkets/preparation.server";
import { runMigrations, validateMigrationTarget } from "../../scripts/migrate-db.mjs";
import { assets, quoteContext, response, instant } from "../fixtures/investment-review";
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || process.env.TEST_DATABASE_DISPOSABLE !== "true")
  throw new Error("Disposable DB required");
const target = validateMigrationTarget(connectionString, "test"), host = target.searchParams.get("host") ?? target.hostname;
if (!["localhost", "127.0.0.1", "[::1]"].includes(host) && !host.startsWith("/tmp/harborline-hl09."))
  throw new Error("Local disposable DB required");
const admin = new Pool({ connectionString }), runtimeUrl = new URL(connectionString);
runtimeUrl.username = "harborline_test_runtime";
runtimeUrl.password = "test-only-runtime";
const db = createDatabase(runtimeUrl.toString()), planning = createPlanningService(createPlanningRepository(db));
let now = Date.parse(instant);
const clock = () => new Date(now), intents = createIntentRepository(db, { fixtureMode: true, clock });
const reviews = createReviewRepository(db, { clock, vault: createReviewVault(Buffer.alloc(32, 9), 1) });
const approvals = createApprovalRepository(db, { clock, fixtureMode: true, fixtureApprovalEnabled: true });
beforeAll(async () => {
  await admin.query("DROP SCHEMA IF EXISTS harborline_private CASCADE;DROP SCHEMA IF EXISTS harborline CASCADE;DROP SCHEMA IF EXISTS drizzle CASCADE");
  await runMigrations(connectionString, "test");
  await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='harborline_test_runtime') THEN CREATE ROLE harborline_test_runtime LOGIN PASSWORD 'test-only-runtime' IN ROLE harborline_app;END IF;END $$`);
});
beforeEach(() => { now = Date.parse(instant); });
afterAll(async () => { await db.close(); await admin.end(); });
async function setup() {
  const identity = { id: randomUUID(), email: "builder@example.invalid" };
  const owner = { ...await bootstrapAccount(identity, db), email: identity.email } as OwnerContext;
  await planning.savePolicy(owner, { expectedRevision: 1, horizonDays: 30, additionalBuffer: "100", acknowledged: true });
  const calculations = createCalculationStore(db, clock);
  const balance = await calculations.recordFixtureBalance(owner, { available: "2000", listingId: assets.cash.id, chain: "solana", venue: "defi" });
  const calculation = await calculations.capture(owner, { expectedRevision: 2, balanceSnapshotId: balance.id });
  const request = { requestKey: randomUUID(), operationKind: "buy", assetId: assets.stock.id, requestedQty: "100", qtyUnit: "quote", calculationId: calculation.id, expectedPolicyRevision: 2 };
  const claimed = await intents.claim(owner, request), preparing = await intents.beginPreparation(owner, claimed.intent.id, 1);
  const prepared = normalizePreparationResponse({ ...response(), order_id: randomUUID() }, { ...quoteContext, observedAt: new Date(now).toISOString() });
  if (prepared.kind !== "prepared")
    throw new Error("fixture");
  const recorded = await reviews.record(owner, { intentId: preparing.id, expectedRevision: preparing.revision, generation: preparing.preparationGeneration, prepared,
    evidence: { source: "contract_fixture", quoteFingerprint: prepared.quote.fingerprint, contractRef: "fixture-only", maximumDebit: "100.5", expiresAt: new Date(now + 30000).toISOString(), feeTreatment: "added_to_input" } });
  if (!recorded.review)
    throw new Error("fixture review");
  await admin.query("UPDATE harborline.gateway_accounts SET provider_user_id=$2,provisioning_state='READY',public_key=$3,wallet_addresses=$4 WHERE id=$1", [owner.accountId, randomUUID(), "02" + "a".repeat(64), JSON.stringify({ solana: "11111111111111111111111111111111" })]);
  const command = { intentId: preparing.id, reviewRevision: recorded.review.reviewRevision, termsHash: recorded.review.termsHash, acknowledged: true };
  const evidence = { source: "contract_fixture", accountId: owner.accountId, listingId: assets.cash.id, chain: "solana", venue: "defi", available: "2000", observedAt: new Date(now).toISOString() };
  return { owner, command, evidence, request, review: recorded.review };
}
const recovery = createRecoveryRepository(db, { clock, fixtureMode: true, fixtureRecoveryEnabled: true });
test("recovery starts from a persisted approval even when no dispatch happened", async () => {
  const d = await setup();
  await approvals.approve(d.owner, d.command, d.evidence);
  const ticket = await recovery.begin(d.owner, d.command.intentId);
  expect(ticket).toMatchObject({ providerOrderId: d.review.providerOrderId });
  expect((await admin.query("SELECT * FROM harborline.order_recovery_reads WHERE account_id=$1", [d.owner.accountId])).rows).toHaveLength(1);
  expect((await admin.query("SELECT * FROM harborline.execution_dispatches WHERE account_id=$1", [d.owner.accountId])).rows).toEqual([]);
});
test("default recovery controls deny reads and writes", async () => {
  const d = await setup();
  await approvals.approve(d.owner, d.command, d.evidence);
  await expect(createRecoveryRepository(db, { clock }).begin(d.owner, d.command.intentId)).rejects.toMatchObject({ code: "disabled" });
});
test("another owner cannot open an order recovery ticket", async () => {
  const d = await setup(), other = await setup();
  await approvals.approve(d.owner, d.command, d.evidence);
  await expect(recovery.begin(other.owner, d.command.intentId)).rejects.toMatchObject({ code: "not_found" });
});
function order(d: Awaited<ReturnType<typeof setup>>, fields: Record<string, unknown> = {}) { return { order_id: d.review.providerOrderId, asset_id: d.request.assetId, qty: "100", qty_unit: "quote", side: "buy", type: "market", chain: "solana", venue: "defi", quote_asset: "USDC", status: "pending", executed_qty: "0", leaves_qty: "0.5", executed_vwap: "0", fee: "0", ...fields }; }
const responseOf = (body: unknown) => ({ source: "contract_fixture" as const, kind: "response" as const, body });
async function approved() { const d = await setup(); await approvals.approve(d.owner, d.command, d.evidence); return d; }
test("a complete read persists actual evidence and keeps financial serialization", async () => {
  const d = await approved(), ticket = await recovery.begin(d.owner, d.command.intentId);
  const result = await recovery.record(d.owner, ticket.id, responseOf(order(d, { status: "complete", executed_qty: "0.5", leaves_qty: "0", fee: "0.5", executed_vwap: "200", secret: "redacted" })));
  expect(result).toMatchObject({ state: "COMPLETE", evidence: { filledBase: "0.5", remainingBase: "0", feeQuote: "0.5" }, slotHeld: true, settlementVerified: false, canExecute: false });
  expect(JSON.stringify(result)).not.toContain("secret");
  expect((await admin.query("SELECT * FROM harborline.execution_attempts WHERE account_id=$1", [d.owner.accountId])).rows).toHaveLength(1);
  expect((await admin.query("SELECT * FROM harborline.execution_dispatches WHERE account_id=$1", [d.owner.accountId])).rows).toEqual([]);
});
test.each(["not_found", "unavailable"] as const)("%s remains uncertain rather than failing the order", async (kind) => {
  const d = await approved(), ticket = await recovery.begin(d.owner, d.command.intentId);
  expect(await recovery.record(d.owner, ticket.id, { source: "contract_fixture", kind })).toMatchObject({ state: "SUBMITTING", latest: { kind }, evidence: null, slotHeld: true });
});
test("initialized does not grant a new execute or release after a crash", async () => {
  const d = await approved(), ticket = await recovery.begin(d.owner, d.command.intentId);
  expect(await recovery.record(d.owner, ticket.id, responseOf(order(d, { status: "initialized" })))).toMatchObject({ state: "SUBMITTING", latest: { kind: "initialized" }, slotHeld: true, canExecute: false });
});
test("repeated recording is idempotent and changed facts for one ticket conflict", async () => {
  const d = await approved(), ticket = await recovery.begin(d.owner, d.command.intentId), result = responseOf(order(d));
  const first = await recovery.record(d.owner, ticket.id, result), rev = (await intents.get(d.owner, d.command.intentId)).revision;
  expect(await recovery.record(d.owner, ticket.id, result)).toEqual(first);
  expect((await intents.get(d.owner, d.command.intentId)).revision).toBe(rev);
  await expect(recovery.record(d.owner, ticket.id, responseOf(order(d, { fee: "0.1" })))).rejects.toMatchObject({ code: "conflict" });
});
test("a late earlier read cannot overwrite the latest read's state", async () => {
  const d = await approved(), older = await recovery.begin(d.owner, d.command.intentId), newer = await recovery.begin(d.owner, d.command.intentId);
  await recovery.record(d.owner, newer.id, responseOf(order(d)));
  expect(await recovery.record(d.owner, older.id, responseOf(order(d, { status: "complete", executed_qty: "0.5", leaves_qty: "0" })))).toMatchObject({ state: "PENDING", evidence: { providerStatus: "pending" } });
  expect((await admin.query("SELECT disposition FROM harborline.order_recovery_observations WHERE read_id=$1", [older.id])).rows[0].disposition).toBe("ignored");
});
test("a response racing an execution-state update cannot overwrite the changed revision", async () => {
  const d = await approved(), ticket = await recovery.begin(d.owner, d.command.intentId);
  await intents.advance(d.owner, d.command.intentId, 4, "COMPLETE");
  expect(await recovery.record(d.owner, ticket.id, responseOf(order(d)))).toMatchObject({ state: "COMPLETE", latest: { disposition: "ignored" }, slotHeld: true });
});
test("terminal contradictions are flagged without rewriting the first terminal state", async () => {
  const d = await approved();
  let ticket = await recovery.begin(d.owner, d.command.intentId);
  await recovery.record(d.owner, ticket.id, responseOf(order(d, { status: "failed" })));
  ticket = await recovery.begin(d.owner, d.command.intentId);
  expect(await recovery.record(d.owner, ticket.id, responseOf(order(d, { status: "complete", executed_qty: "0.5", leaves_qty: "0" })))).toMatchObject({ state: "FAILED", requiresManualReview: true, latest: { disposition: "conflict" }, slotHeld: true });
});
test("a provider fill regression is flagged and cannot replace earlier actual quantities", async () => {
  const d = await approved();
  let ticket = await recovery.begin(d.owner, d.command.intentId);
  await recovery.record(d.owner, ticket.id, responseOf(order(d, { executed_qty: "0.4", leaves_qty: "0.1" })));
  ticket = await recovery.begin(d.owner, d.command.intentId);
  expect(await recovery.record(d.owner, ticket.id, responseOf(order(d, { executed_qty: "0.2", leaves_qty: "0.3" })))).toMatchObject({ state: "PENDING", requiresManualReview: true, evidence: { filledBase: "0.4", partial: true } });
});
test("missing final fill is unknown and never borrowed from a prior partial observation", async () => {
  const d = await approved();
  let ticket = await recovery.begin(d.owner, d.command.intentId);
  await recovery.record(d.owner, ticket.id, responseOf(order(d, { executed_qty: "0.4", leaves_qty: "0.1" })));
  ticket = await recovery.begin(d.owner, d.command.intentId);
  const final = order(d, { status: "complete", leaves_qty: "0" });
  delete (final as Partial<typeof final>).executed_qty;
  expect(await recovery.record(d.owner, ticket.id, responseOf(final))).toMatchObject({ state: "COMPLETE", evidence: { filledBase: null }, slotHeld: true });
});
test("a persisted uncertain order recovers through an owned GET after a fresh service instance", async () => {
  const d = await approved();
  await intents.advance(d.owner, d.command.intentId, 4, "UNKNOWN");
  let calls = 0, seen: unknown;
  const service = createOrderReconciler({ source: "contract_fixture", repository: createRecoveryRepository(db, { clock, fixtureMode: true, fixtureRecoveryEnabled: true }), adapter: createOrderRecoveryAdapter({ async request(method, path, options) { calls++; seen = { method, path, ...options }; return order(d, { status: "complete", executed_qty: "0.5", leaves_qty: "0" }); } }, "contract_fixture") });
  now += 86400000;
  expect(await service.reconcileOrder(d.owner, d.command.intentId)).toMatchObject({ state: "COMPLETE", slotHeld: true, settlementVerified: false });
  expect(seen).toMatchObject({ method: "GET", path: "/v1/gateway/orders/" + d.review.providerOrderId });
  expect(calls).toBe(1);
  expect((await recovery.current(d.owner, d.command.intentId)).state).toBe("COMPLETE");
  expect((await admin.query("SELECT * FROM harborline.execution_attempts WHERE account_id=$1", [d.owner.accountId])).rows).toHaveLength(1);
  expect((await admin.query("SELECT * FROM harborline.execution_dispatches WHERE account_id=$1", [d.owner.accountId])).rows).toEqual([]);
});
test("the provider boundary holds no transaction and newer observer evidence wins", async () => {
  const d = await approved();
  let entered!: () => void, release!: (value: unknown) => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), pending = new Promise(resolve => { release = resolve; });
  const first = createOrderReconciler({ source: "contract_fixture", repository: recovery, adapter: createOrderRecoveryAdapter({ async request() { entered(); return pending; } }, "contract_fixture") });
  const a = first.reconcileOrder(d.owner, d.command.intentId).then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
  expect(await Promise.race([started.then(() => true), a.then(() => false)])).toBe(true);
  const second = createOrderReconciler({ source: "contract_fixture", repository: recovery, adapter: createOrderRecoveryAdapter({ async request() { return order(d); } }, "contract_fixture") });
  expect(await second.reconcileOrder(d.owner, d.command.intentId)).toMatchObject({ state: "PENDING" });
  release(order(d, { status: "complete", executed_qty: "0.5", leaves_qty: "0" }));
  expect(await a).toMatchObject({ ok: true, value: { state: "PENDING" } });
});
test("provider mode cannot initialize recovery or call transport", async () => {
  const d = await approved();
  let calls = 0;
  const service = createOrderReconciler({ source: "provider", repository: recovery, adapter: createOrderRecoveryAdapter({ async request() { calls++; return order(d); } }, "contract_fixture") });
  await expect(service.reconcileOrder(d.owner, d.command.intentId)).rejects.toMatchObject({ code: "disabled" });
  expect(calls).toBe(0);
  expect((await admin.query("SELECT * FROM harborline.order_recovery_reads WHERE account_id=$1", [d.owner.accountId])).rows).toEqual([]);
});
test("provider status alone cannot clear an existing manual-review requirement", async () => {
  const d = await approved();
  await intents.advance(d.owner, d.command.intentId, 4, "MANUAL_REVIEW");
  const ticket = await recovery.begin(d.owner, d.command.intentId);
  expect(await recovery.record(d.owner, ticket.id, responseOf(order(d, { status: "complete", executed_qty: "0.5", leaves_qty: "0" })))).toMatchObject({ state: "MANUAL_REVIEW", requiresManualReview: true, evidence: { providerStatus: "complete" }, slotHeld: true });
});
test("a provider mapping changed during the read fences the response", async () => {
  const d = await approved(), ticket = await recovery.begin(d.owner, d.command.intentId);
  await admin.query("UPDATE harborline.gateway_accounts SET provider_user_id=$2 WHERE id=$1", [d.owner.accountId, randomUUID()]);
  expect(await recovery.record(d.owner, ticket.id, responseOf(order(d)))).toMatchObject({ state: "SUBMITTING", latest: { disposition: "ignored" }, evidence: null, slotHeld: true });
});
test("cross-owner record and current are denied without exposing observation data", async () => {
  const d = await approved(), other = await setup(), ticket = await recovery.begin(d.owner, d.command.intentId);
  await expect(recovery.record(other.owner, ticket.id, responseOf(order(d)))).rejects.toMatchObject({ code: "not_found" });
  await expect(recovery.current(other.owner, d.command.intentId)).rejects.toMatchObject({ code: "not_found" });
  expect((await admin.query("SELECT * FROM harborline.order_recovery_observations WHERE read_id=$1", [ticket.id])).rows).toEqual([]);
});
test("wrong-order evidence is a sticky review conflict and raw private fields never persist", async () => {
  const d = await approved();
  let ticket = await recovery.begin(d.owner, d.command.intentId);
  expect(await recovery.record(d.owner, ticket.id, responseOf(order(d, { order_id: randomUUID(), secret: "private-upstream" })))).toMatchObject({ state: "UNKNOWN", requiresManualReview: true, evidence: null });
  ticket = await recovery.begin(d.owner, d.command.intentId);
  expect(await recovery.record(d.owner, ticket.id, responseOf(order(d, { secret: "private-upstream", typed_data: { secret: "private-upstream" } })))).toMatchObject({ state: "PENDING", requiresManualReview: true });
  const observations = (await admin.query("SELECT * FROM harborline.order_recovery_observations WHERE account_id=$1", [d.owner.accountId])).rows;
  const audit = (await admin.query("SELECT redacted_metadata FROM harborline.audit_events WHERE account_id=$1", [d.owner.accountId])).rows;
  expect(JSON.stringify({ observations, audit })).not.toContain("private-upstream");
});
test("in-flight read recording and stored views remain available after new reads are disabled", async () => {
  const d = await approved(), ticket = await recovery.begin(d.owner, d.command.intentId);
  const disabled = createRecoveryRepository(db, { clock, fixtureMode: true, fixtureRecoveryEnabled: false });
  await expect(disabled.begin(d.owner, d.command.intentId)).rejects.toMatchObject({ code: "disabled" });
  expect(await disabled.record(d.owner, ticket.id, responseOf(order(d)))).toMatchObject({ state: "PENDING" });
  expect(await disabled.current(d.owner, d.command.intentId)).toMatchObject({ state: "PENDING", canExecute: false });
});
test("a pending snapshot cannot regress a terminal outcome or replace its actual evidence", async () => {
  const d = await approved();
  let ticket = await recovery.begin(d.owner, d.command.intentId);
  await recovery.record(d.owner, ticket.id, responseOf(order(d, { status: "complete", executed_qty: "0.5", leaves_qty: "0" })));
  ticket = await recovery.begin(d.owner, d.command.intentId);
  expect(await recovery.record(d.owner, ticket.id, responseOf(order(d)))).toMatchObject({ state: "COMPLETE", evidence: { filledBase: "0.5" }, latest: { disposition: "ignored" } });
});
test.each([{ fee: "0.1" }, { leaves_qty: "0.4" }])("cumulative fee or remaining quantity regressions require review: %j", async (fields) => {
  const d = await approved();
  let ticket = await recovery.begin(d.owner, d.command.intentId);
  await recovery.record(d.owner, ticket.id, responseOf(order(d, { executed_qty: "0.2", leaves_qty: "0.3", fee: "0.2" })));
  ticket = await recovery.begin(d.owner, d.command.intentId);
  expect(await recovery.record(d.owner, ticket.id, responseOf(order(d, { executed_qty: "0.2", leaves_qty: "0.3", fee: "0.2", ...fields })))).toMatchObject({ requiresManualReview: true, latest: { disposition: "conflict" }, evidence: { feeQuote: "0.2", remainingBase: "0.3" } });
});
test("concurrent replay of the same response inserts one observation and one audit", async () => {
  const d = await approved(), ticket = await recovery.begin(d.owner, d.command.intentId), result = responseOf(order(d));
  const [first, second] = await Promise.all([recovery.record(d.owner, ticket.id, result), recovery.record(d.owner, ticket.id, result)]);
  expect(first).toEqual(second);
  expect((await admin.query("SELECT * FROM harborline.order_recovery_observations WHERE read_id=$1", [ticket.id])).rows).toHaveLength(1);
  expect((await admin.query("SELECT * FROM harborline.audit_events WHERE account_id=$1 AND event_type='order_recovery_recorded'", [d.owner.accountId])).rows).toHaveLength(1);
});
test.each(["order_recovery_started", "order_recovery_recorded"])("%s audit failure rolls back all recovery writes", async (event) => {
  const d = await approved(), ticket = event === "order_recovery_recorded" ? await recovery.begin(d.owner, d.command.intentId) : null;
  const before = await intents.get(d.owner, d.command.intentId);
  await admin.query(`CREATE FUNCTION harborline.fail_recovery_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='${event}' THEN RAISE EXCEPTION 'private';END IF;RETURN NEW;END $$;CREATE TRIGGER fail_recovery_audit BEFORE INSERT ON harborline.audit_events FOR EACH ROW EXECUTE FUNCTION harborline.fail_recovery_audit()`);
  try {
    await expect(ticket ? recovery.record(d.owner, ticket.id, responseOf(order(d))) : recovery.begin(d.owner, d.command.intentId)).rejects.toMatchObject({ code: "unavailable", message: "Order recovery is unavailable" });
    expect(await intents.get(d.owner, d.command.intentId)).toEqual(before);
    expect((await admin.query("SELECT * FROM harborline.order_recovery_observations WHERE account_id=$1", [d.owner.accountId])).rows).toEqual([]);
    expect((await admin.query("SELECT * FROM harborline.order_recovery_reads WHERE account_id=$1", [d.owner.accountId])).rows).toHaveLength(ticket ? 1 : 0);
  }
  finally {
    await admin.query("DROP TRIGGER fail_recovery_audit ON harborline.audit_events;DROP FUNCTION harborline.fail_recovery_audit()");
  }
});
test("a suppressed intent update rolls back observation and audit instead of partially recording", async () => {
  const d = await approved(), ticket = await recovery.begin(d.owner, d.command.intentId);
  await admin.query("CREATE FUNCTION harborline.skip_recovery_state() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL;END $$;CREATE TRIGGER skip_recovery_state BEFORE UPDATE ON harborline.investment_intents FOR EACH ROW EXECUTE FUNCTION harborline.skip_recovery_state()");
  try {
    await expect(recovery.record(d.owner, ticket.id, responseOf(order(d)))).rejects.toMatchObject({ code: "conflict" });
    expect((await admin.query("SELECT * FROM harborline.order_recovery_observations WHERE read_id=$1", [ticket.id])).rows).toEqual([]);
    expect((await admin.query("SELECT * FROM harborline.audit_events WHERE account_id=$1 AND event_type='order_recovery_recorded'", [d.owner.accountId])).rows).toEqual([]);
  }
  finally {
    await admin.query("DROP TRIGGER skip_recovery_state ON harborline.investment_intents;DROP FUNCTION harborline.skip_recovery_state()");
  }
});
async function asRole(role: string, ownerId: string | undefined, work: (client: import("pg").PoolClient) => Promise<unknown>) {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    if (ownerId)
      await client.query("SELECT set_config('harborline.owner_id',$1,true)", [ownerId]);
    return await work(client);
  }
  finally {
    await client.query("ROLLBACK");
    client.release();
  }
}
test("recovery tables enforce owner RLS and deny signer, public, update and delete access", async () => {
  const d = await approved(), other = await setup(), ticket = await recovery.begin(d.owner, d.command.intentId);
  await recovery.record(d.owner, ticket.id, responseOf(order(d)));
  for (const table of ["order_recovery_reads", "order_recovery_observations"]) {
    for (const ownerId of [undefined, other.owner.ownerId])
      expect(await asRole("harborline_app", ownerId, async (c) => (await c.query(`SELECT * FROM harborline.${table}`)).rows)).toEqual([]);
    for (const role of ["harborline_key_store", "PUBLIC"]) {
      const privileges = (await admin.query("SELECT has_table_privilege($1,$2,'SELECT') AS read,has_table_privilege($1,$2,'INSERT') AS write", [role === "PUBLIC" ? "public" : role, `harborline.${table}`])).rows[0];
      expect(privileges).toEqual({ read: false, write: false });
    }
    for (const verb of ["UPDATE", "DELETE"]) {
      await expect(asRole("harborline_app", d.owner.ownerId, c => c.query(verb === "UPDATE" ? `UPDATE harborline.${table} SET account_id=account_id` : `DELETE FROM harborline.${table}`))).rejects.toMatchObject({ code: "42501" });
    }
  }
});
test("composite keys reject cross-account ticket and observation associations", async () => {
  const d = await approved(), other = await approved(), ticket = await recovery.begin(d.owner, d.command.intentId);
  const attempt = (await admin.query("SELECT id FROM harborline.execution_attempts WHERE account_id=$1", [d.owner.accountId])).rows[0].id;
  await expect(admin.query("INSERT INTO harborline.order_recovery_reads(account_id,intent_id,attempt_id,intent_revision,binding,source,started_at) VALUES($1,$2,$3,4,'{}','contract_fixture',now())", [other.owner.accountId, other.command.intentId, attempt])).rejects.toMatchObject({ code: "23503" });
  await expect(admin.query("INSERT INTO harborline.order_recovery_observations(read_id,account_id,intent_id,kind,disposition,observation_hash,observed_at,source) VALUES($1,$2,$3,'unavailable','ignored',$4,now(),'contract_fixture')", [ticket.id, other.owner.accountId, other.command.intentId, "a".repeat(64)])).rejects.toMatchObject({ code: "23503" });
});
test.each(["pending", "failed"])("manual review preserves previous terminal evidence before later %s", async (status) => {
  const d = await approved();
  await intents.advance(d.owner, d.command.intentId, 4, "MANUAL_REVIEW");
  let ticket = await recovery.begin(d.owner, d.command.intentId);
  await recovery.record(d.owner, ticket.id, responseOf(order(d, { status: "complete", executed_qty: "0.5", leaves_qty: "0" })));
  ticket = await recovery.begin(d.owner, d.command.intentId);
  const later = order(d, { status, executed_qty: null, leaves_qty: null, fee: null, executed_vwap: null });
  expect(await recovery.record(d.owner, ticket.id, responseOf(later))).toMatchObject({ state: "MANUAL_REVIEW", evidence: { providerStatus: "complete" }, latest: { disposition: status === "pending" ? "ignored" : "conflict" } });
});
test.each([undefined, "provider"] as const)("disabled %s adapter cannot fabricate a provider observation", async (source) => {
  const d = await approved();
  let calls = 0;
  const service = createOrderReconciler({ source: "contract_fixture", repository: recovery, adapter: createOrderRecoveryAdapter({ async request() { calls++; return order(d); } }, source) });
  await expect(service.reconcileOrder(d.owner, d.command.intentId)).rejects.toMatchObject({ code: "disabled" });
  expect(calls).toBe(0);
  expect((await intents.get(d.owner, d.command.intentId)).state).toBe("SUBMITTING");
  expect((await admin.query("SELECT * FROM harborline.order_recovery_observations WHERE account_id=$1", [d.owner.accountId])).rows).toEqual([]);
});
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const execution = createExecutionRepository(db, { clock, fixtureMode: true, fixtureExecutionEnabled: true });
test.each(["initialized", "not_found", "unavailable"] as const)("%s recovery cannot cancel a paused original signer", async (kind) => {
  const d = await approved(), entered = deferred<void>(), resume = deferred<void>();
  let sends = 0;
  const service = createFixtureExecutionService({ source: "contract_fixture", execution, vault: createReviewVault(Buffer.alloc(32, 9), 1), signer: { async stamp() { entered.resolve(); await resume.promise; return ["fixtureStamp"]; } }, adapter: createOrderExecutionAdapter({ async request() { sends++; return { status: "complete" }; } }) });
  const task = service.execute(d.owner, d.command);
  await entered.promise;
  const ticket = await recovery.begin(d.owner, d.command.intentId);
  const result = await recovery.record(d.owner, ticket.id, kind === "initialized" ? responseOf(order(d, { status: "initialized" })) : { source: "contract_fixture", kind });
  resume.resolve();
  await task;
  expect(result).toMatchObject({ state: "SUBMITTING", slotHeld: true });
  expect((await intents.get(d.owner, d.command.intentId)).state).toBe("COMPLETE");
  expect(sends).toBe(1);
  expect((await admin.query("SELECT * FROM harborline.execution_dispatches WHERE account_id=$1", [d.owner.accountId])).rows).toHaveLength(1);
});
test.each(["pending", "unavailable"] as const)("original completion is preserved after an in-flight %s recovery result", async (kind) => {
  const d = await approved(), entered = deferred<void>(), resume = deferred<unknown>();
  let sends = 0;
  const service = createFixtureExecutionService({ source: "contract_fixture", execution, vault: createReviewVault(Buffer.alloc(32, 9), 1), signer: { async stamp() { return ["fixtureStamp"]; } }, adapter: createOrderExecutionAdapter({ async request() { sends++; entered.resolve(); return resume.promise; } }) });
  const task = service.execute(d.owner, d.command);
  await entered.promise;
  const ticket = await recovery.begin(d.owner, d.command.intentId);
  await recovery.record(d.owner, ticket.id, kind === "pending" ? responseOf(order(d)) : { source: "contract_fixture", kind });
  resume.resolve({ status: "complete" });
  await task;
  expect((await recovery.current(d.owner, d.command.intentId))).toMatchObject({ state: "COMPLETE", slotHeld: true, requiresManualReview: false });
  expect(sends).toBe(1);
});
test("a definitive POST contradicting recovered terminal evidence is retained for manual review", async () => {
  const d = await approved(), entered = deferred<void>(), resume = deferred<unknown>();
  const service = createFixtureExecutionService({ source: "contract_fixture", execution, vault: createReviewVault(Buffer.alloc(32, 9), 1), signer: { async stamp() { return ["fixtureStamp"]; } }, adapter: createOrderExecutionAdapter({ async request() { entered.resolve(); return resume.promise; } }) });
  const task = service.execute(d.owner, d.command);
  await entered.promise;
  const ticket = await recovery.begin(d.owner, d.command.intentId);
  await recovery.record(d.owner, ticket.id, responseOf(order(d, { status: "complete", executed_qty: "0.5", leaves_qty: "0" })));
  resume.resolve({ status: "failed" });
  await task;
  expect(await recovery.current(d.owner, d.command.intentId)).toMatchObject({ state: "COMPLETE", requiresManualReview: true, slotHeld: true });
  expect((await admin.query("SELECT redacted_metadata FROM harborline.audit_events WHERE account_id=$1 AND event_type='execution_observed'", [d.owner.accountId])).rows).toEqual([{ redacted_metadata: expect.objectContaining({ providerStatus: "failed", disposition: "conflict" }) }]);
});
test("a POST terminal preserved under manual review also fences later GET evidence", async () => {
  const d = await approved(), dispatch = await execution.claim(d.owner, d.command);
  if (!dispatch)
    throw new Error("fixture dispatch");
  await intents.advance(d.owner, d.command.intentId, 4, "MANUAL_REVIEW");
  await execution.finish(d.owner, d.command, dispatch.attemptId, "complete");
  const ticket = await recovery.begin(d.owner, d.command.intentId);
  expect(await recovery.record(d.owner, ticket.id, responseOf(order(d, { status: "failed", executed_qty: null, leaves_qty: null, fee: null, executed_vwap: null })))).toMatchObject({ state: "MANUAL_REVIEW", latest: { disposition: "conflict" }, requiresManualReview: true, slotHeld: true });
});
test("original response replay is idempotent after a recovery changed state", async () => {
  const d = await approved(), dispatch = await execution.claim(d.owner, d.command);
  if (!dispatch)
    throw new Error("fixture dispatch");
  const ticket = await recovery.begin(d.owner, d.command.intentId);
  await recovery.record(d.owner, ticket.id, responseOf(order(d)));
  await Promise.all([execution.finish(d.owner, d.command, dispatch.attemptId, "complete"), execution.finish(d.owner, d.command, dispatch.attemptId, "complete")]);
  expect((await recovery.current(d.owner, d.command.intentId)).state).toBe("COMPLETE");
  expect((await admin.query("SELECT * FROM harborline.audit_events WHERE account_id=$1 AND event_type='execution_observed'", [d.owner.accountId])).rows).toHaveLength(1);
});
