import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createDatabase, getDatabase } from "../src/server/db";
import { validateMigrationTarget } from "../scripts/migrate-db.mjs";

afterEach(() => vi.unstubAllEnvs());

test("database getter remains disabled in demo without requiring a URL", () => {
  vi.stubEnv("APP_MODE", "demo");
  vi.stubEnv("DATABASE_URL", "");
  expect(() => getDatabase()).toThrow(/configuration/);
});

test("invalid connection settings are rejected without exposing the connection secret", () => {
  for (const url of ["https://user:private-secret@db.invalid/x", "postgresql://user:private-secret@db.invalid/x",
    "postgresql://user:private-secret@db.invalid/x?sslmode=no-verify",
    "postgresql://user:private-secret@localhost/x?host=db.invalid",
    "postgresql://user:private-secret@localhost/x?host=localhost&host=db.invalid"]) {
    try { createDatabase(url); expect.fail("must reject unsafe configuration"); }
    catch (error) { expect(error).toMatchObject({ code: "configuration_error" }); expect(String(error)).not.toContain("private-secret"); }
  }
});

test("invalid owners fail before any pool connection is attempted", async () => {
  const db = createDatabase("postgresql://app@127.0.0.1:65431/harborline_dev");
  try { await expect(db.withOwner("invalid", async () => true)).rejects.toMatchObject({ code: "invalid_owner" }); }
  finally { await db.close(); }
});

test("test migration selection cannot redirect a local-looking URL to a remote host", () => {
  expect(() => validateMigrationTarget("postgresql://postgres@localhost/harborline_test?host=remote.invalid", "test")).toThrow();
  expect(() => validateMigrationTarget("postgresql://postgres@localhost/harborline_test?host=localhost&host=remote.invalid", "test")).toThrow();
  expect(() => validateMigrationTarget("postgresql://postgres@localhost/production", "test")).toThrow();
  expect(() => validateMigrationTarget("postgresql://postgres@localhost/harborline_test", undefined)).toThrow();
});
