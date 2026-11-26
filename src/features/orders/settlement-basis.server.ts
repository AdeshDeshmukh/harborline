import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { auditEvents, balanceSnapshots, executionAttempts, executionDispatches, investmentIntents, orderApprovals, orderRecoveryObservations, orderRecoveryReads, orderReviews } from "../../server/db/schema";
import { isUuid } from "../../server/env";
import { parseAmount } from "../planning/money";
import { MaintenanceError, type SettlementBasis } from "./maintenance-types";
import type { MaintenanceTx, MaintenanceAccount } from "./maintenance-transaction.server";
import { isTerminalState } from "./outcome-history.server";
import { projectStoredReview } from "./reviews.server";
export async function settlementBasis(tx: MaintenanceTx, a: MaintenanceAccount, id: string): Promise<SettlementBasis> {
  if (!isUuid(id))
    throw new MaintenanceError("invalid_request");
  const [i] = await tx.select().from(investmentIntents).where(and(eq(investmentIntents.id, id), eq(investmentIntents.accountId, a.id)));
  if (!i)
    throw new MaintenanceError("not_found");
  if (a.activeOperationId !== i.id || a.provisioningState !== "READY" || !a.providerUserId || !i.effectsPossible || i.preparationSafety !== "contract_fixture" || i.operationKind !== "buy" || i.qtyUnit !== "quote" || !isTerminalState(i.state))
    throw new MaintenanceError("conflict");
  const [known] = await tx.select({ observation: orderRecoveryObservations, read: orderRecoveryReads }).from(orderRecoveryObservations).innerJoin(orderRecoveryReads, eq(orderRecoveryReads.id, orderRecoveryObservations.readId)).where(and(eq(orderRecoveryObservations.accountId, a.id), eq(orderRecoveryObservations.intentId, i.id), eq(orderRecoveryObservations.kind, "observed"), eq(orderRecoveryObservations.disposition, "applied"))).orderBy(desc(orderRecoveryReads.sequence)).limit(1);
  const [newest] = await tx.select({ id: orderRecoveryReads.id }).from(orderRecoveryReads).where(and(eq(orderRecoveryReads.accountId, a.id), eq(orderRecoveryReads.intentId, i.id))).orderBy(desc(orderRecoveryReads.sequence)).limit(1);
  const e = known?.observation.evidence, b = known?.read.binding;
  if (!known || newest?.id !== known.read.id || !e || !b || e.providerStatus.toUpperCase() !== i.state || e.filledBase === null || e.remainingBase === null || e.feeQuote === null || b.providerUserId !== a.providerUserId || b.providerOrderId !== i.providerOrderId || b.assetId !== i.assetId || b.requestedQty !== parseAmount(i.requestedQty) || b.quoteAsset !== "USDC")
    throw new MaintenanceError("conflict");
  const [conflict] = await tx.select({ id: orderRecoveryObservations.readId }).from(orderRecoveryObservations).where(and(eq(orderRecoveryObservations.accountId, a.id), eq(orderRecoveryObservations.intentId, i.id), eq(orderRecoveryObservations.disposition, "conflict"))).limit(1);
  const [executionConflict] = await tx.select({ id: auditEvents.id }).from(auditEvents).where(and(eq(auditEvents.accountId, a.id), eq(auditEvents.intentId, i.id), eq(auditEvents.eventType, "execution_observed"), sql`${auditEvents.metadata}->>'disposition'='conflict'`)).limit(1);
  if (conflict || executionConflict)
    throw new MaintenanceError("conflict");
  const [approval] = await tx.select().from(orderApprovals).where(and(eq(orderApprovals.accountId, a.id), eq(orderApprovals.intentId, i.id)));
  if (!approval || approval.source !== "contract_fixture" || approval.ownerId !== a.ownerId)
    throw new MaintenanceError("conflict");
  const [attempt] = await tx.select({ id: executionAttempts.id }).from(executionAttempts).where(and(eq(executionAttempts.accountId, a.id), eq(executionAttempts.intentId, i.id), eq(executionAttempts.approvalId, approval.id)));
  if (!attempt)
    throw new MaintenanceError("conflict");
  const [dispatch] = await tx.select({ id: executionDispatches.attemptId }).from(executionDispatches).where(and(eq(executionDispatches.accountId, a.id), eq(executionDispatches.attemptId, attempt.id)));
  if (dispatch) {
    const [finished] = await tx.select({ id: auditEvents.id }).from(auditEvents).where(and(eq(auditEvents.accountId, a.id), eq(auditEvents.intentId, i.id), eq(auditEvents.eventType, "execution_observed"), sql`${auditEvents.metadata}->>'attemptId'=${attempt.id}`)).limit(1);
    if (!finished)
      throw new MaintenanceError("conflict");
  }
  const [review] = await tx.select({ intentId: orderReviews.intentId, revision: orderReviews.revision, terms: orderReviews.terms, termsHash: orderReviews.termsHash, maximumDebit: orderReviews.maximumDebit, expiresAt: orderReviews.expiresAt }).from(orderReviews).where(and(eq(orderReviews.accountId, a.id), eq(orderReviews.intentId, i.id), eq(orderReviews.revision, approval.reviewRevision)));
  if (!review || review.termsHash !== approval.termsHash || review.revision !== i.preparationGeneration)
    throw new MaintenanceError("conflict");
  const v = projectStoredReview(review), binding = review.terms.binding;
  const [before] = await tx.select().from(balanceSnapshots).where(and(eq(balanceSnapshots.id, approval.balanceSnapshotId), eq(balanceSnapshots.accountId, a.id)));
  if (!before || before.observedAt > approval.approvedAt || approval.approvedAt > known.read.startedAt || known.read.startedAt > known.observation.observedAt || before.source !== "fixture" || before.listingId !== v.quote.cashId || before.chain !== "solana" || before.venue !== "defi" || !isUuid(v.quote.cashId) || v.providerOrderId !== i.providerOrderId || v.quote.stockId !== i.assetId || v.quote.requestedAmount !== parseAmount(i.requestedQty) || v.quote.quoteIdentifier !== "USDC" || binding.accountId !== a.id || binding.intentId !== i.id || binding.calculationId !== i.calculationId || binding.policyRevision !== i.policyRevision || binding.generation !== i.preparationGeneration)
    throw new MaintenanceError("conflict");
  return Object.freeze({ intentId: i.id, revision: i.revision, readId: known.read.id, providerUserId: a.providerUserId, cashId: v.quote.cashId, providerOrderId: i.providerOrderId!, maximumDebit: v.maximumDebit, beforeAvailable: parseAmount(before.available), terminalAt: known.observation.observedAt.toISOString(), feeTreatment: v.feeTreatment, evidence: Object.freeze({ providerStatus: e.providerStatus, filledBase: e.filledBase, remainingBase: e.remainingBase, feeQuote: e.feeQuote, averagePriceQuote: e.averagePriceQuote, partial: e.partial }) });
}
