import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "./db/schema";

type OwnerTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0];
type ErrorCode = "configuration_error" | "invalid_owner" | "unsafe_role" | "operation_failed";

export class DatabaseError extends Error {
  readonly code: ErrorCode;
  readonly sqlState?: string;
  constructor(code: ErrorCode, sqlState?: string) {
    super(code === "configuration_error" ? "Database configuration is missing, disabled or invalid" : "Database operation could not be completed");
    this.name = "DatabaseError";
    this.code = code;
    this.sqlState = sqlState;
  }
}

export function createDatabase(connectionString: string) {
  try {
    const url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.username || url.pathname.length < 2) throw new Error();
    for (const key of url.searchParams.keys()) {
      if (!["host", "sslmode"].includes(key) || url.searchParams.getAll(key).length !== 1) throw new Error();
    }
    const host = url.searchParams.get("host") ?? url.hostname;
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(host) || host.startsWith("/");
    if (!local && url.searchParams.get("sslmode") !== "verify-full") throw new Error();
  } catch { throw new DatabaseError("configuration_error"); }

  const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10_000, allowExitOnIdle: true });
  // Idle-pool errors otherwise become uncaught events. Keep the diagnostic fixed.
  pool.on("error", () => console.error("Database idle connection failed"));
  const db = drizzle(pool, { schema });
  return {
    async withOwner<T>(ownerId: string, work: (tx: OwnerTransaction) => Promise<T>): Promise<T> {
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(ownerId)) throw new DatabaseError("invalid_owner");
      try {
        return await db.transaction(async tx => {
          const role = await tx.execute<{ unsafe: boolean }>(sql`SELECT
            EXISTS (SELECT 1 FROM pg_roles WHERE rolname = session_user AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole))
            OR pg_has_role(session_user, 'harborline_key_store', 'member') AS unsafe`);
          if (role.rows[0]?.unsafe !== false) throw new DatabaseError("unsafe_role");
          await tx.execute(sql`SET LOCAL ROLE harborline_app`);
          await tx.execute(sql`SELECT set_config('harborline.owner_id', ${ownerId}, true)`);
          return work(tx);
        });
      } catch (error) {
        if (error instanceof DatabaseError) throw error;
        // Drizzle may wrap driver errors. Expose only a bounded SQLSTATE, never
        // the failing query, parameter values, driver detail, or nested cause.
        const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
        const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
        throw new DatabaseError("operation_failed", typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined);
      }
    },
    async close() { await pool.end(); },
  };
}

let singleton: ReturnType<typeof createDatabase> | undefined;

// No env reads, connections or schema changes happen during module import.
export function getDatabase() {
  if (!singleton) {
    if (process.env.APP_MODE !== "pilot" || !process.env.DATABASE_URL) throw new DatabaseError("configuration_error");
    singleton = createDatabase(process.env.DATABASE_URL);
  }
  return singleton;
}
