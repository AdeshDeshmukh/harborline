import "server-only";
import { DatabaseError, getDatabase } from "../../server/db";
import type { PlanningRepository, PlanView } from "./storage-types";
import { PlanningStoreError, type PlanningStoreCode } from "./storage-errors";
import type { OwnerContext } from "../identity/access.server";
import { commitments, gatewayAccounts, planningPolicies } from "../../server/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { parseAmount } from "./money";

type Transaction = Parameters<Parameters<ReturnType<typeof getDatabase>["withOwner"]>[1]>[0];
type Result = { ok: true; value: PlanView } | { ok: false; code: PlanningStoreCode };
const fail = (code: PlanningStoreCode): Result => ({ ok: false, code });

async function ownedAccount(tx: Transaction, context: OwnerContext, writing: boolean) {
  await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
  await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
  const [account] = await tx.select().from(gatewayAccounts)
    .where(and(eq(gatewayAccounts.id, context.accountId), eq(gatewayAccounts.ownerId, context.ownerId)))
    .for(writing ? "update" : "share");
  return account?.externalRefId === context.externalRefId ? account : null;
}
async function view(tx: Transaction, account: typeof gatewayAccounts.$inferSelect): Promise<PlanView> {
  const [policy] = await tx.select().from(planningPolicies).where(eq(planningPolicies.accountId, account.id));
  if (policy && policy.revision !== account.policyRevision) throw new DatabaseError("operation_failed");
  const rows = await tx.select({ id: commitments.id, label: commitments.label, amount: commitments.amount,
    dueDate: commitments.dueDate, status: commitments.status, revision: commitments.revision }).from(commitments)
    .where(eq(commitments.accountId, account.id)).orderBy(asc(commitments.dueDate), asc(commitments.id));
  return { revision: account.policyRevision, policy: policy ? { horizonDays: policy.horizonDays,
    additionalBuffer: parseAmount(policy.additionalBuffer), revision: policy.revision, acknowledgedAt: policy.acknowledgedAt.toISOString() } : null,
    commitments: rows.map(row => ({ ...row, amount: parseAmount(row.amount) })) };
}

export function createPlanningRepository(database = getDatabase()): PlanningRepository {
  async function transaction(context: OwnerContext, work: (tx: Transaction) => Promise<Result>): Promise<PlanView> {
    let result: Result;
    try { result = await database.withOwner(context.ownerId, work); }
    catch { throw new PlanningStoreError("unavailable"); }
    if (!result.ok) throw new PlanningStoreError(result.code);
    return result.value;
  }
  return {
    get: context => transaction(context, async tx => {
      const account = await ownedAccount(tx, context, false);
      return account ? { ok: true, value: await view(tx, account) } : fail("not_found");
    }),
    mutate: (context, command) => transaction(context, async tx => {
      const account = await ownedAccount(tx, context, true);
      if (!account) return fail("not_found");
      if (account.activeOperationId !== null) return fail("operation_in_progress");
      if (command.expectedRevision !== account.policyRevision || account.policyRevision >= 2147483647) return fail("conflict");
      const nextRevision = account.policyRevision + 1;
      const [policy] = await tx.select().from(planningPolicies).where(eq(planningPolicies.accountId, account.id));
      if (policy && policy.revision !== account.policyRevision) throw new DatabaseError("operation_failed");
      if (command.kind === "save_policy") {
        const values = { horizonDays: command.horizonDays, additionalBuffer: command.additionalBuffer,
          revision: nextRevision, acknowledgedAt: sql`now()` };
        await tx.insert(planningPolicies).values({ accountId: account.id, ...values })
          .onConflictDoUpdate({ target: planningPolicies.accountId, set: values });
      } else {
        if (!policy) return fail("plan_required");
        if (command.kind === "create") {
          await tx.insert(commitments).values({ accountId: account.id, label: command.label, amount: command.amount, dueDate: command.dueDate });
        } else {
          const predicate = and(eq(commitments.id, command.id), eq(commitments.accountId, account.id));
          const [row] = await tx.select().from(commitments).where(predicate);
          if (!row) return fail("not_found");
          await tx.update(commitments).set({ ...(command.kind === "remove" ? { status: "removed" as const } : command.changes),
            revision: row.revision + 1 }).where(predicate);
        }
        await tx.update(planningPolicies).set({ revision: nextRevision }).where(eq(planningPolicies.accountId, account.id));
      }
      await tx.update(gatewayAccounts).set({ policyRevision: nextRevision }).where(eq(gatewayAccounts.id, account.id));
      return { ok: true, value: await view(tx, { ...account, policyRevision: nextRevision }) };
    }),
  };
}
