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
import { runMigrations, validateMigrationTarget } from "../../scripts/migrate-db.mjs";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || process.env.TEST_DATABASE_DISPOSABLE !== "true") throw new Error("Explicit disposable database configuration is required");
const target = validateMigrationTarget(connectionString, "test"), host = target.searchParams.get("host") ?? target.hostname;
if (!["localhost", "127.0.0.1", "[::1]"].includes(host) && !host.startsWith("/tmp/harborline-hl09.")) throw new Error("Planning tests require disposable local harborline_test");
const admin = new Pool({ connectionString });
const runtimeUrl = new URL(connectionString); runtimeUrl.username = "harborline_test_runtime"; runtimeUrl.password = "test-only-runtime";
const db = createDatabase(runtimeUrl.toString());
const service = createPlanningService(createPlanningRepository(db));
beforeAll(async () => {
  await admin.query("DROP SCHEMA IF EXISTS harborline_private CASCADE; DROP SCHEMA IF EXISTS harborline CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE");
  await runMigrations(connectionString, "test");
  await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='harborline_test_runtime') THEN
    CREATE ROLE harborline_test_runtime LOGIN PASSWORD 'test-only-runtime' IN ROLE harborline_app; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='harborline_test_guest') THEN CREATE ROLE harborline_test_guest NOLOGIN; END IF; END $$`);
});
afterAll(async () => { await db.close(); await admin.end(); });
async function context() {
  const identity = { id: randomUUID(), email: "builder@example.invalid" };
  return { ...await bootstrapAccount(identity, db), email: identity.email } as OwnerContext;
}
const policy = (expectedRevision = 1, horizonDays = 30) => ({ expectedRevision, horizonDays, additionalBuffer: "500.00", acknowledged: true });
const bill = (expectedRevision = 2) => ({ expectedRevision, label: "Rent", amount: "1200.50", dueDate: "2026-12-01" });

test("planning migration creates forced-RLS policy and commitment tables", async () => {
  const rows = (await admin.query("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace='harborline'::regnamespace AND relname IN ('planning_policies','commitments') ORDER BY relname")).rows;
  expect(rows).toEqual([{ relname: "commitments", relrowsecurity: true, relforcerowsecurity: true },
    { relname: "planning_policies", relrowsecurity: true, relforcerowsecurity: true }]);
});

test("reading an uninitialized plan does not silently create or acknowledge a policy", async () => {
  const owner = await context();
  expect(await service.get(owner)).toEqual({ revision: 1, policy: null, commitments: [] });
  await expect(service.createCommitment(owner, bill(1))).rejects.toMatchObject({ code: "plan_required" });
  expect(await service.get(owner)).toEqual({ revision: 1, policy: null, commitments: [] });
});

test("policy and commitment CRUD survives repository recreation with atomic global revisions", async () => {
  const owner = await context();
  const saved = await service.savePolicy(owner, policy());
  expect(saved).toMatchObject({ revision: 2, policy: { revision: 2, horizonDays: 30, additionalBuffer: "500" }, commitments: [] });
  expect(Number.isFinite(Date.parse(saved.policy!.acknowledgedAt))).toBe(true);
  const created = await service.createCommitment(owner, bill()); const id = created.commitments[0].id;
  expect(created).toMatchObject({ revision: 3, policy: { revision: 3 }, commitments: [{ id, label: "Rent", amount: "1200.5", dueDate: "2026-12-01", status: "outstanding", revision: 1 }] });
  const edited = await service.updateCommitment(owner, { id, expectedRevision: 3, amount: "1250.00", dueDate: "2026-12-02" });
  expect(edited.commitments[0]).toMatchObject({ amount: "1250", dueDate: "2026-12-02", revision: 2 });
  expect((await service.updateCommitment(owner, { id, expectedRevision: 4, status: "paid" })).commitments[0]).toMatchObject({ status: "paid", revision: 3 });
  const removed = await service.removeCommitment(owner, { id, expectedRevision: 5 });
  expect(removed).toMatchObject({ revision: 6, policy: { revision: 6 }, commitments: [{ id, status: "removed", revision: 4 }] });
  expect(await createPlanningService(createPlanningRepository(db)).get(owner)).toEqual(removed);
  expect((await service.updateCommitment(owner, { id, expectedRevision: 6, status: "outstanding" })).commitments[0]).toMatchObject({ status: "outstanding", revision: 5 });
});

test("concurrent stale policy saves yield one winner and one conflict without overwriting it", async () => {
  const owner = await context(); await service.savePolicy(owner, policy());
  const results = await Promise.allSettled([service.savePolicy(owner, policy(2, 60)), service.savePolicy(owner, policy(2, 90))]);
  const winners = results.filter(r => r.status === "fulfilled"); expect(winners).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected").map(r => r.reason.code)).toEqual(["conflict"]);
  const current = await service.get(owner); expect(current.revision).toBe(3);
  expect(current).toEqual(winners[0].status === "fulfilled" ? winners[0].value : null);
});

test("concurrent edits cannot both consume the same planning revision", async () => {
  const owner = await context(); await service.savePolicy(owner, policy());
  const created = await service.createCommitment(owner, bill()), id = created.commitments[0].id;
  const results = await Promise.allSettled([service.updateCommitment(owner, { id, expectedRevision: 3, label: "First edit" }),
    service.updateCommitment(owner, { id, expectedRevision: 3, label: "Second edit" })]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected").map(r => r.reason.code)).toEqual(["conflict"]);
  const current = await service.get(owner); expect(current).toMatchObject({ revision: 4, policy: { revision: 4 }, commitments: [{ id, revision: 2 }] });
  const winner = results.find(r => r.status === "fulfilled"); expect(current).toEqual(winner?.status === "fulfilled" ? winner.value : null);
});

test("another owner cannot read, edit, remove or attach commitments to an account", async () => {
  const first = await context(), second = await context();
  await service.savePolicy(first, policy()); await service.savePolicy(second, policy());
  const created = await service.createCommitment(first, bill()), id = created.commitments[0].id;
  expect((await service.get(second)).commitments).toEqual([]);
  await expect(service.updateCommitment(second, { id, expectedRevision: 2, amount: "1" })).rejects.toMatchObject({ code: "not_found" });
  await expect(service.removeCommitment(second, { id, expectedRevision: 2 })).rejects.toMatchObject({ code: "not_found" });
  await expect(service.get({ ...second, accountId: first.accountId } as OwnerContext)).rejects.toMatchObject({ code: "not_found" });
  await db.withOwner(second.ownerId, async tx => {
    expect((await tx.execute(sql`SELECT id FROM harborline.commitments WHERE id=${id}`)).rows).toEqual([]);
    expect((await tx.execute(sql`UPDATE harborline.commitments SET label='wrong' WHERE id=${id} RETURNING id`)).rows).toEqual([]);
  });
  await expect(db.withOwner(second.ownerId, tx => tx.execute(sql`INSERT INTO harborline.commitments(account_id,label,amount,due_date)
    VALUES(${first.accountId},'wrong',1,'2026-12-01')`))).rejects.toMatchObject({ sqlState: "42501" });
  expect(await service.get(first)).toEqual(created); expect((await service.get(second)).revision).toBe(2);
});

test("planning tables deny public, signer, unscoped and physical-delete access", async () => {
  const owner = await context(); await service.savePolicy(owner, policy());
  for (const role of ["harborline_key_store", "harborline_test_guest", "harborline_app"] as const) {
    const client = await admin.connect();
    try {
      await client.query("BEGIN"); await client.query(`SET LOCAL ROLE ${role}`);
      if (role === "harborline_app") expect((await client.query("SELECT * FROM harborline.planning_policies")).rows).toEqual([]);
      else await expect(client.query("SELECT * FROM harborline.planning_policies")).rejects.toMatchObject({ code: "42501" });
    } finally { await client.query("ROLLBACK"); client.release(); }
  }
  await expect(db.withOwner(owner.ownerId, tx => tx.execute(sql`DELETE FROM harborline.planning_policies`))).rejects.toMatchObject({ sqlState: "42501" });
});

test("database constraints reject invalid economic amounts even behind the app role", async () => {
  const owner = await context(); await service.savePolicy(owner, policy());
  for (const amount of ["0", "-1", "1.001", "NaN"]) {
    await expect(db.withOwner(owner.ownerId, tx => tx.execute(sql`INSERT INTO harborline.commitments(account_id,label,amount,due_date)
      VALUES(${owner.accountId},'bad',${amount},'2026-12-01')`))).rejects.toMatchObject({ sqlState: "23514" });
  }
  expect((await service.get(owner)).commitments).toEqual([]);
});

test("failed revision update rolls back the commitment write and exposes no SQL details", async () => {
  const owner = await context(); await service.savePolicy(owner, policy());
  await admin.query(`CREATE FUNCTION harborline.test_fail_plan_revision() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.id='${owner.accountId}'::uuid THEN RAISE EXCEPTION 'private synthetic query detail'; END IF; RETURN NEW; END $$`);
  await admin.query("CREATE TRIGGER test_fail_plan_revision BEFORE UPDATE ON harborline.gateway_accounts FOR EACH ROW EXECUTE FUNCTION harborline.test_fail_plan_revision()");
  try {
    await expect(service.createCommitment(owner, bill())).rejects.toMatchObject({ code: "unavailable", message: "Planning data is temporarily unavailable" });
    expect(await service.get(owner)).toMatchObject({ revision: 2, policy: { revision: 2 }, commitments: [] });
  } finally { await admin.query("DROP TRIGGER test_fail_plan_revision ON harborline.gateway_accounts; DROP FUNCTION harborline.test_fail_plan_revision()"); }
});

test("active account operations block edits while keeping the current plan readable", async () => {
  const owner = await context(); await service.savePolicy(owner, policy());
  await admin.query("UPDATE harborline.gateway_accounts SET active_operation_id=$1 WHERE id=$2", [randomUUID(), owner.accountId]);
  await expect(service.createCommitment(owner, bill())).rejects.toMatchObject({ code: "operation_in_progress" });
  expect(await service.get(owner)).toMatchObject({ revision: 2, commitments: [] });
});

test("migration reruns preserve saved plans and the two migration journal entries", async () => {
  const owner = await context(), saved = await service.savePolicy(owner, policy());
  await runMigrations(connectionString, "test"); expect(await service.get(owner)).toEqual(saved);
  expect((await admin.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows).toEqual([{ n: 2 }]);
});
