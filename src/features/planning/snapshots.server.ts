import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDatabase } from "../../server/db";
import { balanceSnapshots, calculationSnapshots, commitments, gatewayAccounts, planningPolicies, profiles } from "../../server/db/schema";
import type { OwnerContext } from "../identity/access.server";
import { calculateAllowance } from "./calculate-allowance";
import { horizonEndDate } from "./dates";
import { parseAmount } from "./money";
import { localDateAt, validateTimezone } from "./validation";
import { CalculationStoreError, type BalanceEvidence, type CalculationInput, type CalculationSnapshot, type CalculationStatus, type FixtureBalanceInput } from "./snapshot-types";

type Transaction = Parameters<Parameters<ReturnType<typeof getDatabase>["withOwner"]>[1]>[0];
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function validId(id: string) { if (typeof id !== "string" || !uuid.test(id)) throw new CalculationStoreError("invalid_request"); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function balanceView(row: typeof balanceSnapshots.$inferSelect): BalanceEvidence {
  return freeze({ id: row.id, source: row.source, listingId: row.listingId, chain: row.chain, venue: row.venue,
    available: parseAmount(row.available), observedAt: row.observedAt.toISOString() });
}
function expired(balance: BalanceEvidence, now: Date) {
  const age = now.getTime() - Date.parse(balance.observedAt);
  return !Number.isFinite(age) || age < 0 || age > 15_000;
}
async function ownedAccount(tx: Transaction, context: OwnerContext, writing: boolean) {
  await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
  await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
  const [account] = await tx.select().from(gatewayAccounts)
    .where(and(eq(gatewayAccounts.id, context.accountId), eq(gatewayAccounts.ownerId, context.ownerId)))
    .for(writing ? "update" : "share");
  if (!account || account.externalRefId !== context.externalRefId) throw new CalculationStoreError("not_found");
  return account;
}
async function profileTimezone(tx: Transaction, context: OwnerContext) {
  // Keep a concurrent timezone edit from changing the basis during capture/check.
  const [profile] = await tx.select({ timezone: profiles.timezone }).from(profiles)
    .where(eq(profiles.authUserId, context.ownerId)).for("share");
  if (!profile) throw new CalculationStoreError("not_found");
  return validateTimezone(profile.timezone);
}
async function latestBalance(tx: Transaction, accountId: string) {
  const [row] = await tx.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, accountId))
    .orderBy(desc(balanceSnapshots.sequence)).limit(1);
  return row;
}
async function loadSnapshot(tx: Transaction, accountId: string, id: string): Promise<CalculationSnapshot> {
  const [row] = await tx.select().from(calculationSnapshots).where(and(eq(calculationSnapshots.id, id), eq(calculationSnapshots.accountId, accountId)));
  if (!row) throw new CalculationStoreError("not_found");
  const [balance] = await tx.select().from(balanceSnapshots).where(and(eq(balanceSnapshots.id, row.balanceSnapshotId), eq(balanceSnapshots.accountId, accountId)));
  if (!balance) throw new CalculationStoreError("unavailable");
  return freeze({ id: row.id, source: balance.source, balance: balanceView(balance), policyRevision: row.policyRevision,
    input: row.input, result: row.result, horizonEnd: row.horizonEnd, createdAt: row.createdAt.toISOString() });
}

// This server-only store has no route or live provider composition in HL-16.
// Never accept fixture evidence as authority for preparing/approving an order.
export function createCalculationStore(database = getDatabase(), clock: () => Date = () => new Date()) {
  function now() {
    const value = clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new CalculationStoreError("invalid_request");
    return new Date(value);
  }
  async function transaction<T>(context: OwnerContext, work: (tx: Transaction) => Promise<T>): Promise<T> {
    let outcome: { value: T } | { error: CalculationStoreError };
    try {
      outcome = await database.withOwner(context.ownerId, async tx => {
        try { return { value: await work(tx) }; }
        catch (error) { if (error instanceof CalculationStoreError) return { error }; throw error; }
      });
    } catch { throw new CalculationStoreError("unavailable"); }
    if ("error" in outcome) throw outcome.error;
    return outcome.value;
  }
  return {
    async recordFixtureBalance(context: OwnerContext, input: FixtureBalanceInput): Promise<BalanceEvidence> {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new CalculationStoreError("invalid_request");
      input = { ...input };
      let available: string;
      try {
        if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 4 ||
          Object.keys(input).some(key => !["available", "listingId", "chain", "venue"].includes(key))) throw new Error();
        for (const value of [input.listingId, input.chain, input.venue]) {
          if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 120 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new Error();
        }
        available = parseAmount(input.available);
      } catch { throw new CalculationStoreError("invalid_request"); }
      // Read the clock after acquiring the account lock, so an observation cannot
      // become older than another serialized observation while awaiting the lock.
      return transaction(context, async tx => {
        const account = await ownedAccount(tx, context, true);
        if (account.activeOperationId) throw new CalculationStoreError("operation_in_progress");
        const [row] = await tx.insert(balanceSnapshots).values({ accountId: account.id, source: "fixture", ...input,
          available, observedAt: now() }).returning();
        return balanceView(row);
      });
    },
    async capture(context: OwnerContext, input: { expectedRevision: number; balanceSnapshotId: string }): Promise<CalculationSnapshot> {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new CalculationStoreError("invalid_request");
      input = { ...input };
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 2 ||
        Object.keys(input).some(key => !["expectedRevision", "balanceSnapshotId"].includes(key)) ||
        !Number.isInteger(input.expectedRevision) || input.expectedRevision < 1 || input.expectedRevision > 2147483647) throw new CalculationStoreError("invalid_request");
      validId(input.balanceSnapshotId);
      return transaction(context, async tx => {
        const account = await ownedAccount(tx, context, true), timezone = await profileTimezone(tx, context);
        const timestamp = now();
        if (account.activeOperationId) throw new CalculationStoreError("operation_in_progress");
        if (account.policyRevision !== input.expectedRevision) throw new CalculationStoreError("conflict");
        const [policy] = await tx.select().from(planningPolicies).where(eq(planningPolicies.accountId, account.id));
        if (!policy) throw new CalculationStoreError("plan_required");
        if (policy.revision !== account.policyRevision) throw new CalculationStoreError("unavailable");
        const [balance] = await tx.select().from(balanceSnapshots).where(and(eq(balanceSnapshots.id, input.balanceSnapshotId), eq(balanceSnapshots.accountId, account.id)));
        if (!balance) throw new CalculationStoreError("not_found");
        if ((await latestBalance(tx, account.id))?.id !== balance.id) throw new CalculationStoreError("balance_changed");
        const evidence = balanceView(balance);
        if (expired(evidence, timestamp)) throw new CalculationStoreError("balance_expired");
        const rows = await tx.select({ id: commitments.id, label: commitments.label, amount: commitments.amount, dueDate: commitments.dueDate,
          status: commitments.status, revision: commitments.revision }).from(commitments).where(eq(commitments.accountId, account.id))
          .orderBy(asc(commitments.dueDate), asc(commitments.id));
        const calculationInput: CalculationInput = { available: evidence.available, additionalBuffer: parseAmount(policy.additionalBuffer),
          asOfLocalDate: localDateAt(timestamp, timezone), horizonDays: policy.horizonDays, policyRevision: account.policyRevision,
          timezone, commitments: rows.map(row => ({ ...row, amount: parseAmount(row.amount) })) };
        const result = calculateAllowance(calculationInput);
        const [snapshot] = await tx.insert(calculationSnapshots).values({ accountId: account.id, balanceSnapshotId: balance.id,
          policyRevision: account.policyRevision, formulaVersion: result.formulaVersion, input: calculationInput, result,
          horizonEnd: horizonEndDate(calculationInput.asOfLocalDate, policy.horizonDays), createdAt: timestamp }).returning();
        return loadSnapshot(tx, account.id, snapshot.id);
      });
    },
    async get(context: OwnerContext, id: string): Promise<CalculationSnapshot> {
      validId(id);
      return transaction(context, async tx => {
        const account = await ownedAccount(tx, context, false);
        return loadSnapshot(tx, account.id, id);
      });
    },
    async status(context: OwnerContext, id: string): Promise<CalculationStatus> {
      validId(id);
      return transaction(context, async tx => {
        const account = await ownedAccount(tx, context, false), timezone = await profileTimezone(tx, context);
        const timestamp = now(), snapshot = await loadSnapshot(tx, account.id, id);
        const reason = account.policyRevision !== snapshot.policyRevision ? "policy_changed"
          : timezone !== snapshot.input.timezone ? "timezone_changed"
          : localDateAt(timestamp, timezone) !== snapshot.input.asOfLocalDate ? "date_changed"
          : account.activeOperationId ? "operation_in_progress"
          : (await latestBalance(tx, account.id))?.id !== snapshot.balance.id ? "balance_changed"
          : expired(snapshot.balance, timestamp) ? "balance_expired" : "fixture_only";
        return freeze({ current: reason === "fixture_only", canAuthorize: false, reason });
      });
    },
  };
}
