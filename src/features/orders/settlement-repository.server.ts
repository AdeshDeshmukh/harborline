import "server-only";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { getDatabase } from "../../server/db";
import { balanceSnapshots, gatewayAccounts, investmentIntents, settlementBalanceReads, settlementBalances, settlementVerifications } from "../../server/db/schema";
import type { OwnerContext } from "../identity/access.server";
import { normalizeCashBalance } from "../../integrations/truemarkets/read-contracts";
import { parseAmount } from "../planning/money";
import { isUuid } from "../../server/env";
import { MaintenanceError, maintenanceTime, type BalanceRead } from "./maintenance-types";
import { appendMaintenanceAudit, maintenanceTransaction } from "./maintenance-transaction.server";
import { settlementBasis } from "./settlement-basis.server";
import { normalizeManualClearance, reconcileManualCash } from "./settlement-contracts";
type Options = {
  clock: () => Date;
  fixtureMode?: boolean;
  fixtureClearanceEnabled?: boolean;
  operatorId?: string;
  allowedOperatorIds?: readonly string[];
};
export function createSettlementRepository(database: ReturnType<typeof getDatabase>, options: Options) {
  const transaction = maintenanceTransaction(database), operatorId = options.operatorId, allowed = new Set(options.allowedOperatorIds ?? []);
  function fixture() {
    if (options.fixtureMode !== true)
      throw new MaintenanceError("disabled");
  }
  function operator() {
    fixture();
    if (options.fixtureClearanceEnabled !== true || !isUuid(operatorId) || !allowed.has(operatorId))
      throw new MaintenanceError("disabled");
    return operatorId;
  }
  return {
    async beginBalanceRead(ctx: OwnerContext, id: string): Promise<BalanceRead> {
      fixture();
      return transaction(ctx, async (tx, a) => {
        const basis = await settlementBasis(tx, a, id), now = maintenanceTime(options.clock);
        if (now.getTime() < Date.parse(basis.terminalAt))
          throw new MaintenanceError("conflict");
        const [ticket] = await tx.insert(settlementBalanceReads).values({ accountId: a.id, intentId: basis.intentId, orderReadId: basis.readId, basis, startedAt: now, source: "contract_fixture" }).returning({ id: settlementBalanceReads.id });
        await appendMaintenanceAudit(tx, { accountId: a.id, intentId: basis.intentId, actorId: null, eventType: "settlement_balance_read_started", metadata: { balanceReadId: ticket.id, source: "contract_fixture" }, occurredAt: now });
        return Object.freeze({ ...basis, balanceReadId: ticket.id, balanceStartedAt: now.toISOString() });
      });
    },
    async recordBalance(ctx: OwnerContext, value: BalanceRead, observation: {
      source: string;
      observedAt: string;
      body: unknown;
    }): Promise<{
      id: string;
    }> {
      fixture();
      let basis: BalanceRead, captured: typeof observation;
      try {
        basis = structuredClone(value);
        captured = structuredClone(observation);
      }
      catch {
        throw new MaintenanceError("invalid_request");
      }
      if (captured.source !== "contract_fixture")
        throw new MaintenanceError("disabled");
      return transaction(ctx, async (tx, a) => {
        const current = await settlementBasis(tx, a, basis.intentId);
        const [ticket] = await tx.select().from(settlementBalanceReads).where(and(eq(settlementBalanceReads.id, basis.balanceReadId), eq(settlementBalanceReads.accountId, a.id), eq(settlementBalanceReads.intentId, current.intentId)));
        const [latest] = await tx.select({ id: settlementBalanceReads.id }).from(settlementBalanceReads).where(and(eq(settlementBalanceReads.accountId, a.id), eq(settlementBalanceReads.intentId, current.intentId))).orderBy(desc(settlementBalanceReads.sequence)).limit(1);
        if (!ticket || latest?.id !== ticket.id || ticket.orderReadId !== current.readId || ticket.basis.revision !== current.revision || ticket.basis.providerUserId !== current.providerUserId || ticket.basis.cashId !== current.cashId || ticket.basis.providerOrderId !== current.providerOrderId || current.revision !== basis.revision || current.readId !== basis.readId || current.providerUserId !== basis.providerUserId || current.cashId !== basis.cashId || current.providerOrderId !== basis.providerOrderId)
          throw new MaintenanceError("conflict");
        let balance: ReturnType<typeof normalizeCashBalance>;
        let at: Date;
        try {
          balance = normalizeCashBalance(captured.body, current.cashId);
          at = new Date(captured.observedAt);
          if (at.toISOString() !== captured.observedAt)
            throw new Error();
        }
        catch {
          throw new MaintenanceError("invalid_request");
        }
        fixture();
        const now = maintenanceTime(options.clock), age = now.getTime() - at.getTime();
        if (at.getTime() !== ticket.startedAt.getTime() || age < 0 || age > 15000 || at.getTime() < Date.parse(current.terminalAt))
          throw new MaintenanceError("conflict");
        const [row] = await tx.insert(settlementBalances).values({ balanceReadId: ticket.id, accountId: a.id, intentId: current.intentId, readId: current.readId, intentRevision: current.revision, providerUserId: current.providerUserId, cashId: current.cashId, available: balance.available, total: balance.total, held: balance.held, observedAt: at, recordedAt: now, source: "contract_fixture" }).returning({ id: settlementBalances.id });
        await appendMaintenanceAudit(tx, { accountId: a.id, intentId: current.intentId, actorId: null, eventType: "settlement_balance_observed", metadata: { observationId: row.id, readId: current.readId, source: "contract_fixture" }, occurredAt: now });
        return row;
      });
    },
    async clear(ctx: OwnerContext, value: unknown): Promise<{
      id: string;
      intentId: string;
      method: "manual";
      source: "contract_fixture";
      slotReleased: true;
    }> {
      const actor = operator(), input = normalizeManualClearance(value), hash = createHash("sha256").update(JSON.stringify(["harborline-manual-v1", ctx.accountId, actor, input])).digest("hex");
      return transaction(ctx, async (tx, a) => {
        const [existing] = await tx.select().from(settlementVerifications).where(and(eq(settlementVerifications.accountId, a.id), eq(settlementVerifications.requestKey, input.requestKey)));
        if (existing) {
          if (existing.proofHash !== hash || existing.intentId !== input.intentId)
            throw new MaintenanceError("conflict");
          return { id: existing.id, intentId: existing.intentId, method: "manual", source: "contract_fixture", slotReleased: true };
        }
        const basis = await settlementBasis(tx, a, input.intentId);
        const [observation] = await tx.select().from(settlementBalances).where(and(eq(settlementBalances.id, input.observationId), eq(settlementBalances.accountId, a.id), eq(settlementBalances.intentId, basis.intentId)));
        const [latest] = await tx.select({ id: settlementBalances.id }).from(settlementBalances).where(and(eq(settlementBalances.accountId, a.id), eq(settlementBalances.intentId, basis.intentId))).orderBy(desc(settlementBalances.sequence)).limit(1);
        const [latestCapture] = await tx.select({ id: settlementBalanceReads.id }).from(settlementBalanceReads).where(and(eq(settlementBalanceReads.accountId, a.id), eq(settlementBalanceReads.intentId, basis.intentId))).orderBy(desc(settlementBalanceReads.sequence)).limit(1);
        if (!observation || latestCapture?.id !== observation.balanceReadId || latest?.id !== observation.id || parseAmount(observation.held) !== "0" || observation.readId !== basis.readId || observation.intentRevision !== basis.revision || observation.providerUserId !== basis.providerUserId || observation.cashId !== basis.cashId || input.references.order !== "fixture:" + basis.providerOrderId || input.references.balance !== "fixture:" + observation.id)
          throw new MaintenanceError("conflict");
        reconcileManualCash(basis, observation.available, input);
        const [other] = await tx.select({ id: investmentIntents.id }).from(investmentIntents).where(and(eq(investmentIntents.accountId, a.id), ne(investmentIntents.id, basis.intentId), eq(investmentIntents.effectsPossible, true), sql`NOT EXISTS(SELECT 1 FROM ${settlementVerifications} v WHERE v.intent_id=${investmentIntents.id} AND v.account_id=${investmentIntents.accountId})`)).limit(1);
        operator();
        const now = maintenanceTime(options.clock), age = now.getTime() - observation.observedAt.getTime();
        if (other || now < observation.recordedAt || age < 0 || age > 15000 || observation.observedAt.getTime() < Date.parse(basis.terminalAt))
          throw new MaintenanceError("conflict");
        const [baseline] = await tx.insert(balanceSnapshots).values({ accountId: a.id, source: "fixture", listingId: basis.cashId, chain: "solana", venue: "defi", available: observation.available, observedAt: observation.observedAt }).returning({ id: balanceSnapshots.id });
        const [verified] = await tx.insert(settlementVerifications).values({ baselineBalanceId: baseline.id, accountId: a.id, intentId: basis.intentId, observationId: observation.id, readId: basis.readId, operatorId: actor, requestKey: input.requestKey, proofHash: hash, actualDebit: input.actualDebit, interveningCredits: input.interveningCredits, interveningDebits: input.interveningDebits, references: { ...input.references }, method: "manual", source: "contract_fixture", verifiedAt: now }).returning({ id: settlementVerifications.id });
        const released = await tx.update(gatewayAccounts).set({ activeOperationId: null }).where(and(eq(gatewayAccounts.id, a.id), eq(gatewayAccounts.activeOperationId, basis.intentId))).returning({ id: gatewayAccounts.id });
        if (released.length !== 1)
          throw new MaintenanceError("conflict");
        await appendMaintenanceAudit(tx, { accountId: a.id, intentId: basis.intentId, actorId: null, eventType: "settlement_manually_verified", metadata: { verificationId: verified.id, operatorId: actor, source: "contract_fixture" }, occurredAt: now });
        return { id: verified.id, intentId: basis.intentId, method: "manual", source: "contract_fixture", slotReleased: true };
      });
    },
  };
}
