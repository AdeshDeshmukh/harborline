import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseError, type getDatabase } from "../../server/db";
import { auditEvents, gatewayAccounts } from "../../server/db/schema";
import type { OwnerContext } from "../identity/access.server";
import { MaintenanceError } from "./maintenance-types";
export type MaintenanceTx = Parameters<Parameters<ReturnType<typeof getDatabase>["withOwner"]>[1]>[0];
export type MaintenanceAccount = typeof gatewayAccounts.$inferSelect;
export function maintenanceTransaction(database: ReturnType<typeof getDatabase>) {
  return async <T>(ctx: OwnerContext, work: (tx: MaintenanceTx, account: MaintenanceAccount) => Promise<T>) => {
    let domain: MaintenanceError | undefined;
    try {
      return await database.withOwner(ctx.ownerId, async (tx) => {
        try {
          await tx.execute(sql`SET LOCAL lock_timeout='3s'`);
          await tx.execute(sql`SET LOCAL statement_timeout='5s'`);
          const [account] = await tx.select().from(gatewayAccounts).where(and(eq(gatewayAccounts.id, ctx.accountId), eq(gatewayAccounts.ownerId, ctx.ownerId))).for("update");
          if (!account || account.externalRefId !== ctx.externalRefId)
            throw new MaintenanceError("not_found");
          return await work(tx, account);
        }
        catch (error) {
          if (error instanceof MaintenanceError) {
            domain = error;
            throw new DatabaseError("operation_failed");
          }
          throw error;
        }
      });
    }
    catch {
      throw domain ?? new MaintenanceError("unavailable");
    }
  };
}
export async function appendMaintenanceAudit(tx: MaintenanceTx, value: typeof auditEvents.$inferInsert) {
  const rows = await tx.insert(auditEvents).values(value).returning({ id: auditEvents.id });
  if (rows.length !== 1)
    throw new MaintenanceError("conflict");
}
