import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";

export function validateMigrationTarget(connectionString, target) {
  if (!["test", "local", "pilot"].includes(target) || !connectionString) throw new Error("An explicit migration target and URL are required");
  const url = new URL(connectionString);
  for (const key of url.searchParams.keys()) {
    if (!["host", "sslmode"].includes(key) || url.searchParams.getAll(key).length !== 1) throw new Error("Migration target configuration is invalid");
  }
  const host = url.searchParams.get("host") ?? url.hostname;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(host) || host.startsWith("/");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.username || url.pathname.length < 2 ||
    (target !== "pilot" && !local) || (target === "test" && url.pathname !== "/harborline_test") ||
    (!local && url.searchParams.get("sslmode") !== "verify-full")) throw new Error("Migration target configuration is invalid");
  return url;
}

export async function runMigrations(connectionString, target) {
  validateMigrationTarget(connectionString, target);
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('harborline:migrations'))");
    await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('harborline:migrations'))").catch(() => {});
    await client.end();
  }
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--target") throw new Error();
    await runMigrations(process.env.MIGRATION_DATABASE_URL, process.argv[3]);
    console.log("Selected database migrations completed");
  } catch {
    // Deliberately do not print credentials, connection URLs or raw SQL errors.
    console.error("Migration failed; check the explicitly selected target and administrator configuration");
    process.exitCode = 1;
  }
}
