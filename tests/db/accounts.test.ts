import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
vi.mock("server-only", () => ({}));
import { createDatabase } from "../../src/server/db";
import { profiles } from "../../src/server/db/schema";
import { runMigrations, validateMigrationTarget } from "../../scripts/migrate-db.mjs";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || process.env.TEST_DATABASE_DISPOSABLE !== "true") {
  throw new Error("Explicit TEST_DATABASE_URL and TEST_DATABASE_DISPOSABLE=true are required");
}
const target = validateMigrationTarget(connectionString, "test");
const effectiveHost = target.searchParams.get("host") ?? target.hostname;
if (!["localhost", "127.0.0.1", "[::1]"].includes(effectiveHost) && !effectiveHost.startsWith("/tmp/harborline-hl09.")) {
  throw new Error("Database tests require the disposable local harborline_test database");
}
const admin = new Pool({ connectionString, max: 6 });
const a = randomUUID(), b = randomUUID();
const accountA = randomUUID(), accountB = randomUUID();

async function asRole<T>(role: "harborline_app" | "harborline_key_store" | "harborline_test_guest", owner: string | null, fn: (client: PoolClient) => Promise<T>) {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    if (owner) await client.query("SELECT set_config('harborline.owner_id', $1, true)", [owner]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

beforeAll(async () => {
  // Destructive reset is guarded by the explicit disposable/local checks above.
  await admin.query("DROP SCHEMA IF EXISTS harborline_private CASCADE; DROP SCHEMA IF EXISTS harborline CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE");
  await runMigrations(connectionString, "test");
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='harborline_test_guest') THEN CREATE ROLE harborline_test_guest NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='harborline_test_runtime') THEN
      CREATE ROLE harborline_test_runtime LOGIN PASSWORD 'test-only-runtime' IN ROLE harborline_app;
    END IF;
  END $$`);
  for (const [ownerId, accountId] of [[a, accountA], [b, accountB]]) {
    await asRole("harborline_app", ownerId, async c => {
      await c.query("INSERT INTO harborline.profiles(auth_user_id) VALUES($1)", [ownerId]);
      await c.query("INSERT INTO harborline.gateway_accounts(id, owner_id, external_ref_id) VALUES($1,$2,$3)", [accountId, ownerId, `owner_${ownerId}`]);
    });
  }
});
afterAll(async () => { await admin.end(); });

test("foundation migration installs three tables with forced RLS", async () => {
  const result = await admin.query("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace IN ('harborline'::regnamespace, 'harborline_private'::regnamespace) AND relkind='r' ORDER BY relname");
  expect(result.rows).toEqual([
    { relname: "gateway_accounts", relrowsecurity: true, relforcerowsecurity: true },
    { relname: "profiles", relrowsecurity: true, relforcerowsecurity: true },
    { relname: "signer_secrets", relrowsecurity: true, relforcerowsecurity: true },
  ]);
});

test("owner writes defaults while another owner cannot read, update or insert those rows", async () => {
  for (const ownerId of [a, b]) {
    await asRole("harborline_app", ownerId, async c => {
      const row = (await c.query("SELECT pilot_enabled, eligibility_status FROM harborline.profiles")).rows;
      expect(row).toEqual([{ pilot_enabled: false, eligibility_status: "UNKNOWN" }]);
    });
  }
  await asRole("harborline_app", a, async c => {
    expect((await c.query("SELECT owner_id FROM harborline.gateway_accounts")).rows).toEqual([{ owner_id: a }]);
    expect((await c.query("UPDATE harborline.gateway_accounts SET policy_revision=2 WHERE owner_id=$1", [b])).rowCount).toBe(0);
  });
  await expect(asRole("harborline_app", a, c => c.query("INSERT INTO harborline.profiles(auth_user_id) VALUES($1)", [randomUUID()])))
    .rejects.toMatchObject({ code: "42501" });
});

test("migration reruns preserve existing records instead of reapplying the foundation", async () => {
  const before = (await admin.query("SELECT count(*)::integer AS n FROM harborline.gateway_accounts")).rows;
  await runMigrations(connectionString, "test");
  expect((await admin.query("SELECT count(*)::integer AS n FROM harborline.gateway_accounts")).rows).toEqual(before);
  expect((await admin.query("SELECT count(*)::integer AS n FROM drizzle.__drizzle_migrations")).rows).toEqual([{ n: 1 }]);
});

test("runtime wrapper refuses a migration administrator connection", async () => {
  const db = createDatabase(connectionString);
  try { await expect(db.withOwner(a, async () => true)).rejects.toMatchObject({ code: "unsafe_role" }); }
  finally { await db.close(); }
});

test("unscoped app access is denied by default and context cannot leak after a transaction", async () => {
  await asRole("harborline_app", a, c => c.query("SELECT * FROM harborline.profiles"));
  await asRole("harborline_app", null, async c => {
    expect((await c.query("SELECT * FROM harborline.profiles")).rows).toEqual([]);
    expect((await c.query("SELECT * FROM harborline.gateway_accounts")).rows).toEqual([]);
  });
});

test("guest cannot access app tables; app cannot access secrets, delete rows, or grant itself eligibility", async () => {
  for (const query of ["SELECT * FROM harborline.profiles", "INSERT INTO harborline.profiles(auth_user_id) VALUES(gen_random_uuid())"]) {
    await expect(asRole("harborline_test_guest", a, c => c.query(query))).rejects.toMatchObject({ code: "42501" });
  }
  for (const query of ["SELECT * FROM harborline_private.signer_secrets", "DELETE FROM harborline.gateway_accounts",
    "UPDATE harborline.profiles SET pilot_enabled=true", "UPDATE harborline.profiles SET eligibility_status='ELIGIBLE'"]) {
    await expect(asRole("harborline_app", a, c => c.query(query))).rejects.toMatchObject({ code: "42501" });
  }
});

test("signer role stores only shaped encrypted records and sees only the scoped account", async () => {
  await asRole("harborline_key_store", a, async c => {
    await c.query("INSERT INTO harborline_private.signer_secrets VALUES($1,$2,$3,$4,1,now())", [accountA, Buffer.alloc(32, 1), Buffer.alloc(12, 2), Buffer.alloc(16, 3)]);
    expect((await c.query("SELECT account_id FROM harborline_private.signer_secrets")).rows).toEqual([{ account_id: accountA }]);
  });
  await asRole("harborline_key_store", b, async c => {
    expect((await c.query("SELECT * FROM harborline_private.signer_secrets")).rows).toEqual([]);
  });
  await expect(asRole("harborline_key_store", b, c => c.query("INSERT INTO harborline_private.signer_secrets VALUES($1,$2,$3,$4,1,now())", [accountB, Buffer.alloc(32), Buffer.alloc(1), Buffer.alloc(16)])))
    .rejects.toMatchObject({ code: "23514" });
});

test("concurrent account bootstrap inserts cannot create two mappings for one owner", async () => {
  const ownerId = randomUUID();
  await asRole("harborline_app", ownerId, c => c.query("INSERT INTO harborline.profiles(auth_user_id) VALUES($1)", [ownerId]));
  const attempt = (suffix: string) => asRole("harborline_app", ownerId, c =>
    c.query("INSERT INTO harborline.gateway_accounts(owner_id, external_ref_id) VALUES($1,$2)", [ownerId, `concurrent_${suffix}`]));
  const results = await Promise.allSettled([attempt("one"), attempt("two")]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected").map(r => r.reason.code)).toEqual(["23505"]);
  await asRole("harborline_app", ownerId, async c => {
    expect((await c.query("SELECT count(*)::integer AS n FROM harborline.gateway_accounts")).rows).toEqual([{ n: 1 }]);
  });
});

test("external references and non-null provider IDs are unique across owners", async () => {
  const providerId = randomUUID();
  await asRole("harborline_app", a, c => c.query("UPDATE harborline.gateway_accounts SET provider_user_id=$1 WHERE id=$2", [providerId, accountA]));
  await expect(asRole("harborline_app", b, c => c.query("UPDATE harborline.gateway_accounts SET provider_user_id=$1 WHERE id=$2", [providerId, accountB])))
    .rejects.toMatchObject({ code: "23505" });
  await expect(asRole("harborline_app", b, c => c.query("UPDATE harborline.gateway_accounts SET external_ref_id=$1 WHERE id=$2", [`owner_${a}`, accountB])))
    .rejects.toMatchObject({ code: "23505" });
});

test("the server DB wrapper scopes Drizzle transactions and rolls back on callback failure", async () => {
  const runtimeUrl = new URL(connectionString);
  runtimeUrl.username = "harborline_test_runtime";
  runtimeUrl.password = "test-only-runtime";
  const db = createDatabase(runtimeUrl.toString());
  try {
    const rows = await db.withOwner(a, async tx => tx.select({ id: profiles.authUserId }).from(profiles));
    expect(rows).toEqual([{ id: a }]);
    await expect(db.withOwner(a, async tx => {
      await tx.execute(sql`UPDATE harborline.profiles SET timezone='Asia/Kolkata'`);
      throw new Error("private-callback-error");
    })).rejects.not.toThrow("private-callback-error");
    expect(await db.withOwner(a, async tx => tx.select({ timezone: profiles.timezone }).from(profiles)))
      .toEqual([{ timezone: "UTC" }]);
    expect(await db.withOwner(b, async tx => tx.select({ id: profiles.authUserId }).from(profiles))).toEqual([{ id: b }]);
  } finally { await db.close(); }
});
