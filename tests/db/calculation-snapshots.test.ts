import {seedActiveOperation} from "../fixtures/active-operation";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
vi.mock("server-only", () => ({}));
import { createDatabase } from "../../src/server/db";
import { bootstrapAccount } from "../../src/features/accounts/repository.server";
import type { OwnerContext } from "../../src/features/identity/access.server";
import { createPlanningRepository } from "../../src/features/planning/repository.server";
import { createPlanningService } from "../../src/features/planning/service.server";
import { createCalculationStore } from "../../src/features/planning/snapshots.server";
import { runMigrations, validateMigrationTarget } from "../../scripts/migrate-db.mjs";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || process.env.TEST_DATABASE_DISPOSABLE !== "true") throw new Error("Explicit disposable database configuration is required");
const target = validateMigrationTarget(connectionString, "test"), host = target.searchParams.get("host") ?? target.hostname;
if (!["localhost", "127.0.0.1", "[::1]"].includes(host) && !host.startsWith("/tmp/harborline-hl09.")) throw new Error("Snapshots require disposable local harborline_test");
const admin = new Pool({ connectionString });
const runtimeUrl = new URL(connectionString); runtimeUrl.username = "harborline_test_runtime"; runtimeUrl.password = "test-only-runtime";
const db = createDatabase(runtimeUrl.toString());
const planning = createPlanningService(createPlanningRepository(db));
const instant = new Date("2026-11-25T12:00:00.000Z");
const store = createCalculationStore(db, () => new Date(instant));
const fixture = { available: "2000.00", listingId: "fixture-usdc", chain: "fixture-chain", venue: "fixture-venue" };
const policy = (expectedRevision = 1) => ({ expectedRevision, horizonDays: 30, additionalBuffer: "500", acknowledged: true });
beforeAll(async () => {
  await admin.query("DROP SCHEMA IF EXISTS harborline_private CASCADE; DROP SCHEMA IF EXISTS harborline CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE");
  await runMigrations(connectionString, "test");
  await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='harborline_test_runtime') THEN
    CREATE ROLE harborline_test_runtime LOGIN PASSWORD 'test-only-runtime' IN ROLE harborline_app; END IF; END $$`);
});
afterAll(async () => { await db.close(); await admin.end(); });
async function owner() {
  const identity = { id: randomUUID(), email: "builder@example.invalid" };
  return { ...await bootstrapAccount(identity, db), email: identity.email } as OwnerContext;
}
async function initialized() {
  const context = await owner(); await planning.savePolicy(context, policy());
  const balance = await store.recordFixtureBalance(context, fixture);
  return { context, balance };
}

test("capture persists the exact explanation, original commitments and explicit fixture evidence", async () => {
  const { context, balance } = await initialized();
  await planning.createCommitment(context, { expectedRevision: 2, label: "Rent", amount: "1200", dueDate: "2026-12-01" });
  const snapshot = await store.capture(context, { expectedRevision: 3, balanceSnapshotId: balance.id });
  expect(snapshot).toMatchObject({ policyRevision: 3, horizonEnd: "2026-12-25", source: "fixture",
    input: { available: "2000", additionalBuffer: "500", asOfLocalDate: "2026-11-25", horizonDays: 30, timezone: "UTC",
      commitments: [{ label: "Rent", amount: "1200", status: "outstanding", revision: 1 }] },
    result: { commitmentsTotal: "1200", additionalBuffer: "500", debitBudget: "300", shortfall: "0", formulaVersion: 1 },
    balance: { id: balance.id, source: "fixture", available: "2000", observedAt: instant.toISOString(), ...{ listingId: fixture.listingId, chain: fixture.chain, venue: fixture.venue } } });
  expect(Object.isFrozen(snapshot.input.commitments[0])).toBe(true);
  await planning.updateCommitment(context, { expectedRevision: 3, id: snapshot.input.commitments[0].id, amount: "1500" });
  expect(await createCalculationStore(db).get(context, snapshot.id)).toEqual(snapshot);
  expect(await store.status(context, snapshot.id)).toEqual({ current: false, canAuthorize: false, reason: "policy_changed" });
});

test("capture requires acknowledged policy, exact revision and owned balance without changing revisions", async () => {
  const context = await owner(), balance = await store.recordFixtureBalance(context, fixture);
  await expect(store.capture(context, { expectedRevision: 1, balanceSnapshotId: balance.id })).rejects.toMatchObject({ code: "plan_required" });
  await planning.savePolicy(context, policy());
  await expect(store.capture(context, { expectedRevision: 1, balanceSnapshotId: balance.id })).rejects.toMatchObject({ code: "conflict" });
  await store.capture(context, { expectedRevision: 2, balanceSnapshotId: balance.id });
  expect((await planning.get(context)).revision).toBe(2);
  const other = await owner(); await planning.savePolicy(other, policy());
  await expect(store.capture(other, { expectedRevision: 2, balanceSnapshotId: balance.id })).rejects.toMatchObject({ code: "not_found" });
});

test("current fixture calculations never authorize trading; new balance evidence invalidates the old basis", async () => {
  const { context, balance } = await initialized();
  const snapshot = await store.capture(context, { expectedRevision: 2, balanceSnapshotId: balance.id });
  expect(await store.status(context, snapshot.id)).toEqual({ current: true, canAuthorize: false, reason: "fixture_only" });
  const next = await store.recordFixtureBalance(context, { ...fixture, available: "100" });
  expect(next.id).not.toBe(balance.id);
  expect(await store.status(context, snapshot.id)).toEqual({ current: false, canAuthorize: false, reason: "balance_changed" });
  await expect(store.capture(context, { expectedRevision: 2, balanceSnapshotId: balance.id })).rejects.toMatchObject({ code: "balance_changed" });
});

test("freshness bounds reject stale and future evidence while retaining historical reads", async () => {
  const { context, balance } = await initialized();
  const snapshot = await store.capture(context, { expectedRevision: 2, balanceSnapshotId: balance.id });
  const at = (offset: number) => createCalculationStore(db, () => new Date(instant.getTime() + offset));
  expect((await at(15000).status(context, snapshot.id)).current).toBe(true);
  for (const offset of [15001, -1]) {
    await expect(at(offset).capture(context, { expectedRevision: 2, balanceSnapshotId: balance.id })).rejects.toMatchObject({ code: "balance_expired" });
    expect(await at(offset).status(context, snapshot.id)).toEqual({ current: false, canAuthorize: false, reason: "balance_expired" });
  }
  expect(await at(60000).get(context, snapshot.id)).toEqual(snapshot);
});

test("timezone change and local midnight invalidate the old date basis even with fresh evidence", async () => {
  const context = await owner(); await planning.savePolicy(context, policy());
  const before = new Date("2026-11-25T23:59:59Z");
  const beforeStore = createCalculationStore(db, () => before);
  const balance = await beforeStore.recordFixtureBalance(context, fixture);
  const snapshot = await beforeStore.capture(context, { expectedRevision: 2, balanceSnapshotId: balance.id });
  const afterStore = createCalculationStore(db, () => new Date("2026-11-26T00:00:01Z"));
  expect(await afterStore.status(context, snapshot.id)).toEqual({ current: false, canAuthorize: false, reason: "date_changed" });
  await db.withOwner(context.ownerId, tx => tx.execute(sql`UPDATE harborline.profiles SET timezone='Asia/Kolkata' WHERE auth_user_id=${context.ownerId}`));
  expect(await beforeStore.status(context, snapshot.id)).toEqual({ current: false, canAuthorize: false, reason: "timezone_changed" });
});

test("concurrent capture and edits produce either conflict or an immediately invalidated intact snapshot", async () => {
  const { context, balance } = await initialized();
  const results = await Promise.allSettled([store.capture(context, { expectedRevision: 2, balanceSnapshotId: balance.id }),
    planning.savePolicy(context, policy(2))]);
  expect(results[1].status).toBe("fulfilled");
  if (results[0].status === "fulfilled") {
    expect(results[0].value.policyRevision).toBe(2);
    expect((await store.status(context, results[0].value.id)).reason).toBe("policy_changed");
  } else expect(results[0].reason.code).toBe("conflict");
  expect((await planning.get(context)).revision).toBe(3);
});

test("RLS isolates both snapshot tables; runtime cannot modify or physically delete evidence", async () => {
  const { context, balance } = await initialized();
  const snapshot = await store.capture(context, { expectedRevision: 2, balanceSnapshotId: balance.id });
  const other = await owner();
  await expect(store.get(other, snapshot.id)).rejects.toMatchObject({ code: "not_found" });
  for (const table of ["balance_snapshots", "calculation_snapshots"]) {
    expect((await db.withOwner(other.ownerId, tx => tx.execute(sql.raw(`SELECT * FROM harborline.${table}`)))).rows).toEqual([]);
    for (const verb of ["UPDATE", "DELETE"]) {
      const query = verb === "UPDATE" ? `UPDATE harborline.${table} SET id=id` : `DELETE FROM harborline.${table}`;
      await expect(db.withOwner(context.ownerId, tx => tx.execute(sql.raw(query)))).rejects.toMatchObject({ sqlState: "42501" });
    }
  }
  const rows = (await admin.query("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace='harborline'::regnamespace AND relname IN ('balance_snapshots','calculation_snapshots') ORDER BY relname")).rows;
  expect(rows).toEqual([{ relname: "balance_snapshots", relrowsecurity: true, relforcerowsecurity: true }, { relname: "calculation_snapshots", relrowsecurity: true, relforcerowsecurity: true }]);
});

test("invalid identifiers, revisions, amounts and clocks fail before any evidence is written", async () => {
  const { context, balance } = await initialized();
  for (const available of ["NaN", "-1", "1e3"]) await expect(store.recordFixtureBalance(context, { ...fixture, available })).rejects.toMatchObject({ code: "invalid_request" });
  await expect(store.recordFixtureBalance(context, { ...fixture, source: "provider" } as typeof fixture)).rejects.toMatchObject({ code: "invalid_request" });
  for (const expectedRevision of [0, 1.5, 2147483648]) await expect(store.capture(context, { expectedRevision, balanceSnapshotId: balance.id })).rejects.toMatchObject({ code: "invalid_request" });
  await expect(store.get(context, "bad")).rejects.toMatchObject({ code: "invalid_request" });
  await expect(createCalculationStore(db, () => new Date(NaN)).recordFixtureBalance(context, fixture)).rejects.toMatchObject({ code: "invalid_request" });
});

test("database rejects cross-owner inserts, cross-account balance references and provider source claims", async () => {
  const { context, balance } = await initialized(), other = await owner();
  const insertBalance = (accountId: string, source: string, amount: string) => db.withOwner(other.ownerId, tx => tx.execute(sql`
    INSERT INTO harborline.balance_snapshots(account_id,source,listing_id,chain,venue,available,observed_at)
    VALUES(${accountId},${source},'fixture','fixture','fixture',${amount},now())`));
  await expect(insertBalance(context.accountId, "fixture", "1")).rejects.toMatchObject({ sqlState: "42501" });
  await expect(insertBalance(other.accountId, "provider", "1")).rejects.toMatchObject({ sqlState: "23514" });
  for (const amount of ["NaN", "-1"]) await expect(insertBalance(other.accountId, "fixture", amount)).rejects.toMatchObject({ sqlState: "23514" });
  await expect(db.withOwner(other.ownerId, tx => tx.execute(sql`INSERT INTO harborline.calculation_snapshots
    (account_id,balance_snapshot_id,policy_revision,formula_version,input,result,horizon_end,created_at)
    VALUES(${other.accountId},${balance.id},2,1,'{}','{}','2026-12-25',now())`))).rejects.toMatchObject({ sqlState: "23503" });
  const client = await admin.connect();
  try {
    await client.query("BEGIN; SET LOCAL ROLE harborline_key_store");
    await expect(client.query("SELECT * FROM harborline.balance_snapshots")).rejects.toMatchObject({ code: "42501" });
  } finally { await client.query("ROLLBACK"); client.release(); }
  await db.withOwner(other.ownerId, async tx => {
    expect((await tx.execute(sql`SELECT * FROM harborline.balance_snapshots`)).rows).toEqual([]);
  });
});

test("rerunning the additive migration preserves both immutable evidence and calculation", async () => {
  const { context, balance } = await initialized();
  const snapshot = await store.capture(context, { expectedRevision: 2, balanceSnapshotId: balance.id });
  await runMigrations(connectionString, "test");
  expect(await store.get(context, snapshot.id)).toEqual(snapshot);
  expect((await admin.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows).toEqual([{ n: 7 }]);
});

test("queued balance writes preserve submitted identity and amount when the caller reuses its object", async () => {
  const { context } = await initialized();
  const mutableBalance = { ...fixture };
  const pendingBalance = store.recordFixtureBalance(context, mutableBalance);
  mutableBalance.listingId = "different-listing"; mutableBalance.available = "1";
  const evidence = await pendingBalance;
  expect(evidence).toMatchObject({ listingId: "fixture-usdc", available: "2000" });
});

test("queued captures preserve submitted revision and evidence identity when the caller reuses its object", async () => {
  const { context, balance: evidence } = await initialized();
  const mutableCapture = { expectedRevision: 2, balanceSnapshotId: evidence.id };
  const pendingCapture = store.capture(context, mutableCapture);
  mutableCapture.expectedRevision = 999; mutableCapture.balanceSnapshotId = randomUUID();
  expect(await pendingCapture).toMatchObject({ policyRevision: 2, balance: { id: evidence.id, listingId: "fixture-usdc" } });
});

test("historical retrieval does not depend on validity of the current profile timezone", async () => {
  const { context, balance } = await initialized();
  const snapshot = await store.capture(context, { expectedRevision: 2, balanceSnapshotId: balance.id });
  await db.withOwner(context.ownerId, tx => tx.execute(sql`UPDATE harborline.profiles SET timezone='invalid-zone' WHERE auth_user_id=${context.ownerId}`));
  expect(await store.get(context, snapshot.id)).toEqual(snapshot);
  await expect(store.status(context, snapshot.id)).rejects.toMatchObject({ code: "unavailable" });
});

test("latest snapshot lookup is owner-scoped and does not append or supersede evidence", async () => {
  const { context, balance } = await initialized();
  expect(await store.latest(context)).toBeNull();
  const snapshot = await store.capture(context, { expectedRevision: 2, balanceSnapshotId: balance.id });
  const before = (await admin.query("SELECT (SELECT count(*) FROM harborline.balance_snapshots) AS b, (SELECT count(*) FROM harborline.calculation_snapshots) AS c")).rows;
  expect(await store.latest(context)).toEqual(snapshot);
  expect(await store.latest(await owner())).toBeNull();
  expect((await admin.query("SELECT (SELECT count(*) FROM harborline.balance_snapshots) AS b, (SELECT count(*) FROM harborline.calculation_snapshots) AS c")).rows).toEqual(before);
  expect((await store.status(context, snapshot.id)).current).toBe(true);
});

test("active operations block new capture; failed insertion redacts details and leaves no partial calculation", async () => {
  const { context, balance } = await initialized();
  await seedActiveOperation(admin, context.accountId);
  await expect(store.capture(context, { expectedRevision: 2, balanceSnapshotId: balance.id })).rejects.toMatchObject({ code: "operation_in_progress" });
  await admin.query("UPDATE harborline.gateway_accounts SET active_operation_id=NULL WHERE id=$1", [context.accountId]);
  await admin.query(`CREATE FUNCTION harborline.test_fail_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private synthetic detail'; END $$`);
  await admin.query("CREATE TRIGGER test_fail_snapshot BEFORE INSERT ON harborline.calculation_snapshots FOR EACH ROW EXECUTE FUNCTION harborline.test_fail_snapshot()");
  try {
    await expect(store.capture(context, { expectedRevision: 2, balanceSnapshotId: balance.id })).rejects.toMatchObject({ code: "unavailable", message: "Calculation data is temporarily unavailable" });
    expect((await admin.query("SELECT id FROM harborline.calculation_snapshots WHERE account_id=$1", [context.accountId])).rows).toEqual([]);
  } finally { await admin.query("DROP TRIGGER test_fail_snapshot ON harborline.calculation_snapshots; DROP FUNCTION harborline.test_fail_snapshot()"); }
});
