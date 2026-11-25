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
import { createFixtureApprovalService } from "../../src/features/orders/approve.server";
import { hashReviewTerms } from "../../src/features/orders/review-terms.server";
import type { ApprovalReceipt } from "../../src/features/orders/approval-types";
import { normalizePreparationResponse } from "../../src/integrations/truemarkets/preparation.server";
import { runMigrations, validateMigrationTarget } from "../../scripts/migrate-db.mjs";
import { assets, quoteContext, response, instant } from "../fixtures/investment-review";
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || process.env.TEST_DATABASE_DISPOSABLE !== "true") throw new Error("Disposable DB required");
const target = validateMigrationTarget(connectionString, "test"), host = target.searchParams.get("host") ?? target.hostname;
if (!["localhost", "127.0.0.1", "[::1]"].includes(host) && !host.startsWith("/tmp/harborline-hl09.")) throw new Error("Local disposable DB required");
const admin = new Pool({ connectionString }), runtimeUrl = new URL(connectionString);
runtimeUrl.username = "harborline_test_runtime"; runtimeUrl.password = "test-only-runtime";
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
  if (prepared.kind !== "prepared") throw new Error("fixture");
  const recorded = await reviews.record(owner, { intentId: preparing.id, expectedRevision: preparing.revision, generation: preparing.preparationGeneration, prepared,
    evidence: { source: "contract_fixture", quoteFingerprint: prepared.quote.fingerprint, contractRef: "fixture-only", maximumDebit: "100.5", expiresAt: new Date(now + 30000).toISOString(), feeTreatment: "added_to_input" } });
  if (!recorded.review) throw new Error("fixture review");
  await admin.query("UPDATE harborline.gateway_accounts SET provider_user_id=$2,provisioning_state='READY',public_key=$3,wallet_addresses=$4 WHERE id=$1", [owner.accountId, randomUUID(), "02" + "a".repeat(64), JSON.stringify({ solana: "11111111111111111111111111111111" })]);
  const command = { intentId: preparing.id, reviewRevision: recorded.review.reviewRevision, termsHash: recorded.review.termsHash, acknowledged: true };
  const evidence = { source: "contract_fixture", accountId: owner.accountId, listingId: assets.cash.id, chain: "solana", venue: "defi", available: "2000", observedAt: new Date(now).toISOString() };
  return { owner, command, evidence, request, review: recorded.review };
}
async function counts(accountId: string) {
  const row = (await admin.query(`SELECT
    (SELECT count(*)::int FROM harborline.order_approvals WHERE account_id=$1) AS approvals,
    (SELECT count(*)::int FROM harborline.execution_attempts WHERE account_id=$1) AS attempts,
    (SELECT count(*)::int FROM harborline.balance_snapshots WHERE account_id=$1) AS balances,
    (SELECT count(*)::int FROM harborline.audit_events WHERE account_id=$1 AND event_type='approval_recorded') AS audits`, [accountId])).rows[0];
  return row;
}
test("twenty competing approvals persist one claim and one submission transition", async () => {
  const d = await setup();
  const results = await Promise.all(Array.from({ length: 20 }, () => approvals.approve(d.owner, d.command, d.evidence)));
  expect(results.filter(r => r.accepted)).toHaveLength(1);
  expect(new Set(results.map(r => r.attemptId)).size).toBe(1);
  expect(results.every(r => r.canExecute === false && r.source === "contract_fixture")).toBe(true);
  expect(await counts(d.owner.accountId)).toEqual({ approvals: 1, attempts: 1, balances: 2, audits: 1 });
  expect(await intents.get(d.owner, d.command.intentId)).toMatchObject({ state: "SUBMITTING", revision: 4, effectsPossible: true });
  const saved = (await admin.query("SELECT * FROM harborline.order_approvals WHERE intent_id=$1", [d.command.intentId])).rows[0];
  expect(saved).toMatchObject({ owner_id: d.owner.ownerId, terms_hash: d.command.termsHash, review_revision: 1 });
});
test.each([{}, { fixtureMode: true }, { fixtureApprovalEnabled: true }])("disabled-by-default controls %j write nothing", async flags => {
  const d = await setup(), repository = createApprovalRepository(db, { clock, ...flags });
  await expect(repository.approve(d.owner, d.command, d.evidence)).rejects.toMatchObject({ code: "disabled" });
  expect(await counts(d.owner.accountId)).toEqual({ approvals: 0, attempts: 0, balances: 1, audits: 0 });
});
test.each(["hash", "revision", "expiry", "balance_age", "future_balance", "cash_change", "policy", "timezone", "slot", "binding", "listing", "provider_source", "wrong_account", "route", "provisioning", "stored_hash", "stored_debit", "commitments", "buffer"])("changed %s grants no approval", async kind => {
  const d = await setup(), command = { ...d.command }, evidence = { ...d.evidence };
  if (kind === "hash") command.termsHash = "0".repeat(64);
  if (kind === "revision") command.reviewRevision++;
  if (kind === "expiry") now += 20000;
  if (kind === "balance_age") now += 15001;
  if (kind === "future_balance") evidence.observedAt = new Date(now + 1).toISOString();
  if (kind === "cash_change") evidence.available = "2001";
  if (kind === "policy") await admin.query("UPDATE harborline.gateway_accounts SET policy_revision=3 WHERE id=$1", [d.owner.accountId]);
  if (kind === "timezone") await admin.query("UPDATE harborline.profiles SET timezone='Asia/Kolkata' WHERE auth_user_id=$1", [d.owner.ownerId]);
  if (kind === "slot") await admin.query("UPDATE harborline.gateway_accounts SET active_operation_id=NULL WHERE id=$1", [d.owner.accountId]);
  if (kind === "binding") {
    const terms = (await admin.query("SELECT terms FROM harborline.order_reviews WHERE intent_id=$1", [command.intentId])).rows[0].terms;
    terms.binding.accountId = randomUUID(); command.termsHash = hashReviewTerms(terms);
    await admin.query("UPDATE harborline.order_reviews SET terms=$2,terms_hash=$3 WHERE intent_id=$1", [command.intentId, terms, command.termsHash]);
  }
  if (kind === "listing") evidence.listingId = randomUUID();
  if (kind === "provider_source") evidence.source = "provider";
  if (kind === "wrong_account") evidence.accountId = randomUUID();
  if (kind === "route") evidence.chain = "ethereum";
  if (kind === "provisioning") await admin.query("UPDATE harborline.gateway_accounts SET provisioning_state='FAILED' WHERE id=$1", [d.owner.accountId]);
  if (kind === "stored_hash") await admin.query("UPDATE harborline.order_reviews SET terms_hash=repeat('0',64) WHERE intent_id=$1", [command.intentId]);
  if (kind === "stored_debit") await admin.query("UPDATE harborline.order_reviews SET maximum_debit=101 WHERE intent_id=$1", [command.intentId]);
  if (kind === "commitments") await admin.query("INSERT INTO harborline.commitments(account_id,label,amount,due_date) VALUES($1,'Rent',1900,'2026-11-26')", [d.owner.accountId]);
  if (kind === "buffer") await admin.query("UPDATE harborline.planning_policies SET additional_buffer=101 WHERE account_id=$1", [d.owner.accountId]);
  await expect(approvals.approve(d.owner, command, evidence)).rejects.toMatchObject({ code: expect.stringMatching(/^(conflict|stale_inputs|unavailable)$/) });
  expect(await counts(d.owner.accountId)).toEqual({ approvals: 0, attempts: 0, balances: 1, audits: 0 });
  expect((await intents.get(d.owner, command.intentId)).state).toBe("REVIEW_READY");
});
test("fresh matching cash can replace an aged observation without changing reviewed terms", async () => {
  const d = await setup(); now += 19000;
  expect(await approvals.approve(d.owner, d.command, { ...d.evidence, observedAt: new Date(now).toISOString() })).toMatchObject({ accepted: true, termsHash: d.command.termsHash });
});
test("balance freshness includes exactly fifteen seconds but review expiry is exclusive", async () => {
  const d = await setup(); now += 15000;
  expect(await approvals.approve(d.owner, d.command, d.evidence)).toMatchObject({ accepted: true });
});
test("another owner cannot approve or observe an approval", async () => {
  const d = await setup(), other = await setup();
  await expect(approvals.approve(other.owner, d.command, d.evidence)).rejects.toMatchObject({ code: "not_found" });
  expect(await counts(d.owner.accountId)).toMatchObject({ approvals: 0, attempts: 0 });
});
test("an exact replay observes the original claim after expiry without new evidence", async () => {
  const d = await setup(), first = await approvals.approve(d.owner, d.command, d.evidence); now += 86400000;
  expect(await approvals.approve(d.owner, d.command, null)).toEqual({ ...first, accepted: false });
  await expect(approvals.approve(d.owner, { ...d.command, termsHash: "0".repeat(64) }, null)).rejects.toMatchObject({ code: "conflict" });
  const held = await intents.get(d.owner, d.command.intentId); expect(await intents.cleanup(d.owner, held.id, held.revision)).toEqual(held);
  expect(await counts(d.owner.accountId)).toEqual({ approvals: 1, attempts: 1, balances: 2, audits: 1 });
});
test("audit failure rolls back approval, attempt, fresh balance and transition", async () => {
  const d = await setup();
  await admin.query(`CREATE FUNCTION harborline.test_approval_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='approval_recorded' THEN RAISE EXCEPTION 'private detail';END IF;RETURN NEW;END $$;CREATE TRIGGER test_approval_audit BEFORE INSERT ON harborline.audit_events FOR EACH ROW EXECUTE FUNCTION harborline.test_approval_audit()`);
  try {
    await expect(approvals.approve(d.owner, d.command, d.evidence)).rejects.toMatchObject({ code: "unavailable" });
    expect(await counts(d.owner.accountId)).toEqual({ approvals: 0, attempts: 0, balances: 1, audits: 0 });
    expect(await intents.get(d.owner, d.command.intentId)).toMatchObject({ state: "REVIEW_READY", effectsPossible: false });
  } finally { await admin.query("DROP TRIGGER test_approval_audit ON harborline.audit_events;DROP FUNCTION harborline.test_approval_audit()"); }
});
test("a suppressed state compare-and-swap cannot leave a durable claim", async () => {
  const d = await setup();
  await admin.query(`CREATE FUNCTION harborline.test_approval_cas() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='SUBMITTING' THEN RETURN NULL;END IF;RETURN NEW;END $$;CREATE TRIGGER test_approval_cas BEFORE UPDATE ON harborline.investment_intents FOR EACH ROW EXECUTE FUNCTION harborline.test_approval_cas()`);
  try {
    await expect(approvals.approve(d.owner, d.command, d.evidence)).rejects.toMatchObject({ code: "conflict" });
    expect(await counts(d.owner.accountId)).toEqual({ approvals: 0, attempts: 0, balances: 1, audits: 0 });
  } finally { await admin.query("DROP TRIGGER test_approval_cas ON harborline.investment_intents;DROP FUNCTION harborline.test_approval_cas()"); }
});
test("competing service approvals call the fixture executor once after the claim commits", async () => {
  const d = await setup(); let calls = 0;
  let callbackClaim: ApprovalReceipt | undefined, callbackCounts: unknown, callbackReplay: ApprovalReceipt | null | undefined;
  const service = createFixtureApprovalService({ source: "contract_fixture", approvals, refreshFixtureEvidence: async () => d.evidence,
    fixtureExecutor: async claim => {
      calls++; callbackClaim = claim;
      callbackCounts = await counts(d.owner.accountId);
      // A second transaction can take the account lock during the callback.
      callbackReplay = await approvals.get(d.owner, d.command);
    } });
  const results = await Promise.all(Array.from({ length: 20 }, () => service.approve(d.owner, d.command)));
  expect(calls).toBe(1); expect(results.filter(r => r.accepted)).toHaveLength(1);
  expect(results.find(r => r.accepted)?.state).toBe("SUBMITTING");
  expect(callbackClaim).toMatchObject({ accepted: true, state: "SUBMITTING", canExecute: false });
  expect(callbackCounts).toMatchObject({ approvals: 1, attempts: 1, audits: 1 });
  expect(callbackReplay).toMatchObject({ accepted: false, attemptId: callbackClaim?.attemptId });
});
test("a lost fixture response becomes UNKNOWN and replay never refreshes or executes again", async () => {
  const d = await setup(); let calls = 0, refreshes = 0;
  const service = createFixtureApprovalService({ source: "contract_fixture", approvals,
    refreshFixtureEvidence: async () => { refreshes++; return d.evidence; },
    fixtureExecutor: async () => { calls++; throw new Error("private synthetic response"); } });
  const first = await service.approve(d.owner, d.command);
  expect(first).toMatchObject({ accepted: true, state: "UNKNOWN", canExecute: false });
  now += 86400000;
  expect(await service.approve(d.owner, d.command)).toEqual({ ...first, accepted: false });
  expect(calls).toBe(1); expect(refreshes).toBe(1); expect(JSON.stringify(first)).not.toContain("private");
  const held = await intents.get(d.owner, d.command.intentId);
  expect(held.effectsPossible).toBe(true); expect(await intents.cleanup(d.owner, held.id, held.revision)).toEqual(held);
  expect((await admin.query("SELECT active_operation_id FROM harborline.gateway_accounts WHERE id=$1", [d.owner.accountId])).rows[0].active_operation_id).toBe(held.id);
});
test("a crash after the durable claim cannot be repaired by dispatching a replay", async () => {
  const d = await setup(), first = await approvals.approve(d.owner, d.command, d.evidence);
  const fail = async (): Promise<never> => { throw new Error("must not run"); };
  const service = createFixtureApprovalService({ source: "contract_fixture", approvals, refreshFixtureEvidence: fail, fixtureExecutor: fail });
  expect(await service.approve(d.owner, d.command)).toEqual({ ...first, accepted: false });
});
test("disabled fixture service does not refresh evidence or call an executor", async () => {
  const d = await setup(), fail = async (): Promise<never> => { throw new Error("must not run"); };
  const service = createFixtureApprovalService({ source: "contract_fixture", approvals: createApprovalRepository(db, { clock }), refreshFixtureEvidence: fail, fixtureExecutor: fail });
  await expect(service.approve(d.owner, d.command)).rejects.toMatchObject({ code: "disabled" });
  expect(await counts(d.owner.accountId)).toMatchObject({ approvals: 0, attempts: 0 });
});
test("control changes during evidence refresh block the handoff", async () => {
  const d = await setup(), flags = { clock, fixtureMode: true, fixtureApprovalEnabled: true }; let calls = 0;
  const service = createFixtureApprovalService({ source: "contract_fixture", approvals: createApprovalRepository(db, flags),
    refreshFixtureEvidence: async () => { flags.fixtureApprovalEnabled = false; return d.evidence; }, fixtureExecutor: async () => { calls++; } });
  await expect(service.approve(d.owner, d.command)).rejects.toMatchObject({ code: "disabled" });
  expect(calls).toBe(0); expect(await counts(d.owner.accountId)).toMatchObject({ approvals: 0, attempts: 0 });
});
test("failed refresh exposes only a bounded error and creates no claim", async () => {
  const d = await setup(); let calls = 0;
  const service = createFixtureApprovalService({ source: "contract_fixture", approvals, refreshFixtureEvidence: async () => { throw new Error("private access token"); }, fixtureExecutor: async () => { calls++; } });
  await expect(service.approve(d.owner, d.command)).rejects.toMatchObject({ code: "unavailable", message: "Approval is temporarily unavailable" });
  expect(calls).toBe(0); expect(await counts(d.owner.accountId)).toMatchObject({ approvals: 0, attempts: 0 });
});
test("two different intents on an account cannot both win approval", async () => {
  const d = await setup(); await intents.abandon(d.owner, d.command.intentId, 3);
  const claimed = await intents.claim(d.owner, { ...d.request, requestKey: randomUUID() }), preparing = await intents.beginPreparation(d.owner, claimed.intent.id, 1);
  const prepared = normalizePreparationResponse({ ...response(), order_id: randomUUID() }, quoteContext);
  if (prepared.kind !== "prepared") throw new Error("fixture");
  const r = await reviews.record(d.owner, { intentId: preparing.id, expectedRevision: 2, generation: 1, prepared,
    evidence: { source: "contract_fixture", quoteFingerprint: prepared.quote.fingerprint, contractRef: "fixture-only", maximumDebit: "100.5", expiresAt: "2026-11-25T12:00:30.000Z", feeTreatment: "added_to_input" } });
  if (!r.review) throw new Error("fixture");
  const next = { intentId: preparing.id, reviewRevision: r.review.reviewRevision, termsHash: r.review.termsHash, acknowledged: true };
  const result = await Promise.allSettled([approvals.approve(d.owner, d.command, d.evidence), approvals.approve(d.owner, next, d.evidence)]);
  expect(result.map(r => r.status)).toEqual(["rejected", "fulfilled"]);
  expect(await counts(d.owner.accountId)).toMatchObject({ approvals: 1, attempts: 1 });
});
test("approval and attempt records are owner isolated and append-only for the runtime", async () => {
  const d = await setup(), other = await setup(); await approvals.approve(d.owner, d.command, d.evidence);
  for (const table of ["order_approvals", "execution_attempts"]) {
    for (const owner of [null, other.owner.ownerId]) {
      const client = await admin.connect();
      try {
        await client.query("BEGIN;SET LOCAL ROLE harborline_app");
        if (owner) await client.query("SELECT set_config('harborline.owner_id',$1,true)", [owner]);
        expect((await client.query(`SELECT * FROM harborline.${table}`)).rows).toEqual([]);
      } finally { await client.query("ROLLBACK"); client.release(); }
    }
    for (const query of [`UPDATE harborline.${table} SET source='provider'`, `DELETE FROM harborline.${table}`]) {
      const client = await admin.connect();
      try { await client.query("BEGIN;SET LOCAL ROLE harborline_app"); await client.query("SELECT set_config('harborline.owner_id',$1,true)", [d.owner.ownerId]); await expect(client.query(query)).rejects.toMatchObject({ code: "42501" }); }
      finally { await client.query("ROLLBACK"); client.release(); }
    }
    const client = await admin.connect();
    try { await client.query("BEGIN;SET LOCAL ROLE harborline_key_store"); await expect(client.query(`SELECT * FROM harborline.${table}`)).rejects.toMatchObject({ code: "42501" }); }
    finally { await client.query("ROLLBACK"); client.release(); }
  }
});
test("attempt ownership cannot be forged across an approval account boundary", async () => {
  const d = await setup(), other = await setup();
  // A storage-only fixture with no attempt isolates this FK from unique-claim
  // constraints; real approvals create these rows together atomically.
  const claim = (await admin.query(`INSERT INTO harborline.order_approvals(account_id,intent_id,owner_id,review_revision,terms_hash,balance_snapshot_id,source,approved_at)
    SELECT $1,$2,$3,$4,$5,balance_snapshot_id,'contract_fixture',$6 FROM harborline.calculation_snapshots WHERE id=$7 RETURNING id`,
  [d.owner.accountId, d.command.intentId, d.owner.ownerId, d.command.reviewRevision, d.command.termsHash, instant, d.request.calculationId])).rows[0];
  const client = await admin.connect();
  try {
    await client.query("BEGIN;SET LOCAL ROLE harborline_app");
    await client.query("SELECT set_config('harborline.owner_id',$1,true)", [other.owner.ownerId]);
    await expect(client.query("INSERT INTO harborline.execution_attempts(account_id,intent_id,approval_id,source,started_at) VALUES($1,$2,$3,'contract_fixture',$4)", [other.owner.accountId, other.command.intentId, claim.id, instant])).rejects.toMatchObject({ code: "23503", constraint: "attempt_owned_approval_fk" });
  } finally { await client.query("ROLLBACK"); client.release(); }
  expect(await counts(other.owner.accountId)).toMatchObject({ approvals: 0, attempts: 0 });
});
test("a fresh observation that ages while waiting for the account lock is rejected", async () => {
  const d = await setup(), lock = await admin.connect();
  try {
    await lock.query("BEGIN"); await lock.query("SELECT id FROM harborline.gateway_accounts WHERE id=$1 FOR UPDATE", [d.owner.accountId]);
    const pending = approvals.approve(d.owner, d.command, d.evidence);
    now += 15001; await lock.query("COMMIT");
    await expect(pending).rejects.toMatchObject({ code: "stale_inputs" });
  } finally { await lock.query("ROLLBACK"); lock.release(); }
  expect(await counts(d.owner.accountId)).toMatchObject({ approvals: 0, attempts: 0 });
});
test("a local date change invalidates approval even with fresh unchanged cash", async () => {
  const d = await setup();
  // An originally valid calculation from a different local date cannot supply authority.
  await admin.query("UPDATE harborline.calculation_snapshots SET input=jsonb_set(input,'{asOfLocalDate}','\"2026-11-24\"') WHERE id=$1", [d.request.calculationId]);
  await expect(approvals.approve(d.owner, d.command, d.evidence)).rejects.toMatchObject({ code: "stale_inputs" });
  expect(await counts(d.owner.accountId)).toMatchObject({ approvals: 0, attempts: 0 });
});
test.each(["expiry", "balance", "controls", "date", "within_bounds"])("authorization rechecks %s after the later profile lock", async kind => {
  if (kind === "date") now = Date.parse("2026-11-25T23:59:59.500Z");
  const d = await setup(), flags = { clock, fixtureMode: true, fixtureApprovalEnabled: true };
  if (kind === "expiry") now += 19500;
  if (kind === "balance") now += 14900;
  if (kind === "within_bounds") now += 1000;
  const evidence = kind === "expiry" ? { ...d.evidence, observedAt: new Date(now).toISOString() } : d.evidence;
  let calls = 0;
  const service = createFixtureApprovalService({ source: "contract_fixture", approvals: createApprovalRepository(db, flags), refreshFixtureEvidence: async () => evidence, fixtureExecutor: async () => { calls++; } });
  const lock = await admin.connect();
  await lock.query("BEGIN"); await lock.query("SELECT auth_user_id FROM harborline.profiles WHERE auth_user_id=$1 FOR UPDATE", [d.owner.ownerId]);
  const pending = service.approve(d.owner, d.command).then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
  try {
    // Observe the actual second-lock wait instead of guessing with a sleep.
    let waiting = false; const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      const result = await admin.query("SELECT 1 FROM pg_stat_activity WHERE usename='harborline_test_runtime' AND datname=current_database() AND wait_event_type='Lock' AND query LIKE '%profiles%' AND query LIKE '%for share%'");
      if (result.rowCount) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    now += kind === "balance" ? 101 : 501;
    if (kind === "controls") flags.fixtureApprovalEnabled = false;
    await lock.query("COMMIT");
  } finally { await lock.query("ROLLBACK"); lock.release(); }
  const result = await pending;
  if (kind === "within_bounds") {
    expect(result).toMatchObject({ ok: true, value: { accepted: true, approvedAt: new Date(now).toISOString() } });
    expect(calls).toBe(1);
  } else {
    expect(result).toMatchObject({ ok: false, error: { code: kind === "expiry" ? "conflict" : kind === "controls" ? "disabled" : "stale_inputs" } });
    expect(calls).toBe(0); expect(await counts(d.owner.accountId)).toEqual({ approvals: 0, attempts: 0, balances: 1, audits: 0 });
  }
});
test("a refresh cannot promote an observation older than the reviewed balance", async () => {
  const d = await setup(); now += 1000;
  const evidence = { ...d.evidence, observedAt: new Date(Date.parse(instant) - 5000).toISOString() };
  await expect(approvals.approve(d.owner, d.command, evidence)).rejects.toMatchObject({ code: "stale_inputs" });
  expect(await counts(d.owner.accountId)).toEqual({ approvals: 0, attempts: 0, balances: 1, audits: 0 });
});
test("failure to persist uncertainty returns unavailable after a committed handoff", async () => {
  const d = await setup(), flags = { clock, fixtureMode: true, fixtureApprovalEnabled: true }; let calls = 0;
  const service = createFixtureApprovalService({ source: "contract_fixture", approvals: createApprovalRepository(db, flags), refreshFixtureEvidence: async () => d.evidence,
    fixtureExecutor: async () => { calls++; flags.fixtureApprovalEnabled = false; throw new Error("private failed callback"); } });
  await expect(service.approve(d.owner, d.command)).rejects.toMatchObject({ code: "unavailable" });
  expect(calls).toBe(1); expect(await counts(d.owner.accountId)).toEqual({ approvals: 1, attempts: 1, balances: 2, audits: 1 });
  expect(await intents.get(d.owner, d.command.intentId)).toMatchObject({ state: "SUBMITTING", effectsPossible: true });
  flags.fixtureApprovalEnabled = true;
  expect(await service.approve(d.owner, d.command)).toMatchObject({ accepted: false, state: "SUBMITTING" });
  expect(calls).toBe(1);
});
