import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { DatabaseError, type getDatabase } from "../../server/db";
import { auditEvents, executionAttempts, gatewayAccounts, investmentIntents, orderApprovals, orderRecoveryObservations, orderRecoveryReads, orderReviews, settlementVerifications } from "../../server/db/schema";
import { isUuid } from "../../server/env";
import type { OwnerContext } from "../identity/access.server";
import { RecoveryError, type RecoveryBinding, type RecoveryDisposition, type RecoveryEvidence, type RecoveryKind, type RecoveryReadResult, type RecoveryView } from "./recovery-types";
import { projectStoredReview } from "./reviews.server";
import { compareAmounts, parseAmount } from "../planning/money";
import { normalizeRecoveryOrder } from "../../integrations/truemarkets/recovery-contracts";
import { isTerminalState, terminalOutcome } from "./outcome-history.server";
type Tx = Parameters<Parameters<ReturnType<typeof getDatabase>["withOwner"]>[1]>[0];
type Account = typeof gatewayAccounts.$inferSelect;
type Intent = typeof investmentIntents.$inferSelect;
export function createRecoveryRepository(database: ReturnType<typeof getDatabase>, options: {
  clock: () => Date;
  fixtureMode?: boolean;
  fixtureRecoveryEnabled?: boolean;
}) {
  function enabled() {
    if (options.fixtureMode !== true || options.fixtureRecoveryEnabled !== true) {
      throw new RecoveryError("disabled");
    }
  }
  function time() {
    const now = options.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new RecoveryError("unavailable");
    }
    return new Date(now);
  }
  async function transaction<T>(ctx: OwnerContext, work: (tx: Tx, a: Account) => Promise<T>, writing = true) {
    let domain: RecoveryError | undefined;
    try {
      return await database.withOwner(ctx.ownerId, async (tx) => {
        try {
          await tx.execute(sql`SET LOCAL lock_timeout='3s'`);
          await tx.execute(sql`SET LOCAL statement_timeout='5s'`);
          const [a] = await tx.select().from(gatewayAccounts).where(and(eq(gatewayAccounts.id, ctx.accountId), eq(gatewayAccounts.ownerId, ctx.ownerId))).for(writing ? "update" : "share");
          if (!a || a.externalRefId !== ctx.externalRefId)
            throw new RecoveryError("not_found");
          return await work(tx, a);
        }
        catch (e) {
          if (e instanceof RecoveryError) {
            domain = e;
            throw new DatabaseError("operation_failed");
          }
          throw e;
        }
      });
    }
    catch {
      throw domain ?? new RecoveryError("unavailable");
    }
  }
  async function intent(tx: Tx, a: Account, id: string) {
    if (!isUuid(id))
      throw new RecoveryError("invalid_request");
    const [i] = await tx.select().from(investmentIntents).where(and(eq(investmentIntents.id, id), eq(investmentIntents.accountId, a.id)));
    if (!i)
      throw new RecoveryError("not_found");
    return i;
  }
  async function binding(tx: Tx, ctx: OwnerContext, a: Account, i: Intent) {
    if (i.preparationSafety !== "contract_fixture" || i.operationKind !== "buy" || i.qtyUnit !== "quote" || !i.effectsPossible || !i.providerOrderId || a.provisioningState !== "READY" || !a.providerUserId || a.activeOperationId !== i.id)
      throw new RecoveryError("conflict");
    const [approval] = await tx.select().from(orderApprovals).where(and(eq(orderApprovals.intentId, i.id), eq(orderApprovals.accountId, a.id)));
    if (!approval || approval.ownerId !== ctx.ownerId || approval.source !== "contract_fixture")
      throw new RecoveryError("conflict");
    const [attempt] = await tx.select().from(executionAttempts).where(and(eq(executionAttempts.approvalId, approval.id), eq(executionAttempts.intentId, i.id), eq(executionAttempts.accountId, a.id)));
    const [review] = await tx.select({ intentId: orderReviews.intentId, revision: orderReviews.revision, terms: orderReviews.terms, termsHash: orderReviews.termsHash, maximumDebit: orderReviews.maximumDebit, expiresAt: orderReviews.expiresAt }).from(orderReviews).where(and(eq(orderReviews.intentId, i.id), eq(orderReviews.accountId, a.id), eq(orderReviews.revision, approval.reviewRevision)));
    if (!attempt || attempt.source !== "contract_fixture" || !review || approval.termsHash !== review.termsHash || review.revision !== i.preparationGeneration)
      throw new RecoveryError("conflict");
    const v = projectStoredReview(review), b = review.terms.binding;
    if (b.accountId !== a.id || b.intentId !== i.id || b.generation !== i.preparationGeneration || b.calculationId !== i.calculationId || b.policyRevision !== i.policyRevision || v.providerOrderId !== i.providerOrderId || v.quote.stockId !== i.assetId || v.quote.requestedAmount !== parseAmount(i.requestedQty))
      throw new RecoveryError("conflict");
    const value: RecoveryBinding = { providerOrderId: i.providerOrderId, providerUserId: a.providerUserId, assetId: i.assetId, requestedQty: parseAmount(i.requestedQty), quoteAsset: v.quote.quoteIdentifier, baseDecimals: v.quote.baseDecimals };
    return { attempt, value };
  }
  async function view(tx: Tx, a: Account, i: Intent): Promise<RecoveryView> {
    const [last] = await tx.select({ row: orderRecoveryObservations }).from(orderRecoveryObservations).innerJoin(orderRecoveryReads, eq(orderRecoveryReads.id, orderRecoveryObservations.readId)).where(and(eq(orderRecoveryObservations.accountId, a.id), eq(orderRecoveryObservations.intentId, i.id))).orderBy(desc(orderRecoveryReads.sequence)).limit(1);
    const [known] = await tx.select({ evidence: orderRecoveryObservations.evidence }).from(orderRecoveryObservations).innerJoin(orderRecoveryReads, eq(orderRecoveryReads.id, orderRecoveryObservations.readId)).where(and(eq(orderRecoveryObservations.accountId, a.id), eq(orderRecoveryObservations.intentId, i.id), eq(orderRecoveryObservations.kind, "observed"), eq(orderRecoveryObservations.disposition, "applied"))).orderBy(desc(orderRecoveryReads.sequence)).limit(1);
    const [conflict] = await tx.select({ id: orderRecoveryObservations.readId }).from(orderRecoveryObservations).where(and(eq(orderRecoveryObservations.accountId, a.id), eq(orderRecoveryObservations.intentId, i.id), eq(orderRecoveryObservations.disposition, "conflict"))).limit(1);
    const [executionConflict] = await tx.select({ id: auditEvents.id }).from(auditEvents).where(and(eq(auditEvents.accountId, a.id), eq(auditEvents.intentId, i.id), eq(auditEvents.eventType, "execution_observed"), sql`${auditEvents.metadata}->>'disposition'='conflict'`)).limit(1);
    const [verification] = await tx.select({id:settlementVerifications.id}).from(settlementVerifications).where(and(eq(settlementVerifications.accountId,a.id),eq(settlementVerifications.intentId,i.id))).limit(1);
    const e = known?.evidence;
    const evidence = e ? Object.freeze({ providerStatus: e.providerStatus, filledBase: e.filledBase, remainingBase: e.remainingBase, averagePriceQuote: e.averagePriceQuote, feeQuote: e.feeQuote, partial: e.partial }) : null;
    return Object.freeze({ intentId: i.id, state: i.state, evidence, latest: last ? { readId: last.row.readId, kind: last.row.kind, disposition: last.row.disposition, observedAt: last.row.observedAt.toISOString() } : null, requiresManualReview: !!conflict || !!executionConflict || i.state === "MANUAL_REVIEW", slotHeld: a.activeOperationId === i.id, settlementVerified: !!verification, canExecute: false, source: "contract_fixture" });
  }
  return {
    async begin(ctx: OwnerContext, intentId: string) {
      enabled();
      return transaction(ctx, async (tx, a) => {
        const i = await intent(tx, a, intentId), b = await binding(tx, ctx, a, i);
        if (!["SUBMITTING", "UNKNOWN", "PENDING", "MANUAL_REVIEW", "COMPLETE", "FAILED", "CANCELED"].includes(i.state))
          throw new RecoveryError("conflict");
        enabled();
        const now = time();
        const [row] = await tx.insert(orderRecoveryReads).values({ accountId: a.id, intentId: i.id, attemptId: b.attempt.id, intentRevision: i.revision, binding: b.value, source: "contract_fixture", startedAt: now }).returning({ id: orderRecoveryReads.id });
        await tx.insert(auditEvents).values({ accountId: a.id, intentId: i.id, actorId: ctx.ownerId, eventType: "order_recovery_started", metadata: { readId: row.id, source: "contract_fixture" }, occurredAt: now });
        return { id: row.id, providerOrderId: b.value.providerOrderId, providerUserId: b.value.providerUserId };
      });
    },
    async current(ctx: OwnerContext, intentId: string) {
      if (options.fixtureMode !== true) throw new RecoveryError("disabled");
      return transaction(ctx, async (tx, a) => {
        const i = await intent(tx, a, intentId);
        if (i.preparationSafety !== "contract_fixture") throw new RecoveryError("disabled");
        return view(tx, a, i);
      }, false);
    },
    async record(ctx: OwnerContext, readId: string, result: RecoveryReadResult): Promise<RecoveryView> {
      if (options.fixtureMode !== true)
        throw new RecoveryError("disabled");
      if (!isUuid(readId))
        throw new RecoveryError("invalid_request");
      let captured: RecoveryReadResult;
      try {
        captured = structuredClone(result);
      }
      catch {
        throw new RecoveryError("invalid_request");
      }
      if (!captured || captured.source !== "contract_fixture" || !["response", "unavailable", "not_found"].includes(captured.kind))
        throw new RecoveryError("invalid_request");
      return transaction(ctx, async (tx, a) => {
        const [ticket] = await tx.select().from(orderRecoveryReads).where(and(eq(orderRecoveryReads.id, readId), eq(orderRecoveryReads.accountId, a.id)));
        if (!ticket)
          throw new RecoveryError("not_found");
        const i = await intent(tx, a, ticket.intentId);
        let kind: RecoveryKind = captured.kind === "response" ? "observed" : captured.kind, evidence: RecoveryEvidence | null = null;
        if (captured.kind === "response")
          try {
            evidence = normalizeRecoveryOrder(captured.body, ticket.binding);
            if (evidence.providerStatus === "initialized")
              kind = "initialized";
          }
          catch {
            kind = "invalid_response";
          }
        const hash = createHash("sha256").update(JSON.stringify(["harborline-recovery-v1", kind, evidence])).digest("hex");
        const [existing] = await tx.select({ hash: orderRecoveryObservations.observationHash }).from(orderRecoveryObservations).where(and(eq(orderRecoveryObservations.readId, ticket.id), eq(orderRecoveryObservations.accountId, a.id)));
        if (existing) {
          if (existing.hash !== hash)
            throw new RecoveryError("conflict");
          return view(tx, a, i);
        }
        const [latest] = await tx.select({ id: orderRecoveryReads.id }).from(orderRecoveryReads).where(and(eq(orderRecoveryReads.intentId, i.id), eq(orderRecoveryReads.accountId, a.id))).orderBy(desc(orderRecoveryReads.sequence)).limit(1);
        let matches = false;
        // JSONB key order is not preserved. Compare binding values explicitly.
        try {
          const current = await binding(tx, ctx, a, i), b = ticket.binding, c = current.value;
          matches = current.attempt.id === ticket.attemptId && c.providerOrderId === b.providerOrderId && c.providerUserId === b.providerUserId && c.assetId === b.assetId && c.requestedQty === b.requestedQty && c.quoteAsset === b.quoteAsset && c.baseDecimals === b.baseDecimals;
        }
        catch (e) {
          if (!(e instanceof RecoveryError))
            throw e;
        }
        // Reads commit before transport. Only the newest ticket at the unchanged
        // intent revision may apply; a late response remains history, not authority.
        let disposition: RecoveryDisposition = latest?.id === ticket.id && ticket.intentRevision === i.revision && matches ? "applied" : "ignored";
        const terminal = await terminalOutcome(tx, a.id, i.id, i.state);
        const mapped = evidence && kind === "observed" ? ({ complete: "COMPLETE", failed: "FAILED", canceled: "CANCELED", pending: "PENDING", active: "PENDING", cancel_pending: "PENDING", initialized: "UNKNOWN" } as const)[evidence.providerStatus] : null;
        if (disposition === "applied") {
          if (terminal && mapped && mapped !== terminal)
            disposition = isTerminalState(mapped) ? "conflict" : "ignored";
          if (kind === "initialized" && (terminal || i.state === "PENDING"))
            disposition = "ignored";
          if (kind === "invalid_response")
            disposition = "conflict";
          if (evidence && kind === "observed" && disposition === "applied") {
            const [prior] = await tx.select({ filled: sql<string | null>`max((${orderRecoveryObservations.evidence}->>'filledBase')::numeric)`, fee: sql<string | null>`max((${orderRecoveryObservations.evidence}->>'feeQuote')::numeric)`, remaining: sql<string | null>`min((${orderRecoveryObservations.evidence}->>'remainingBase')::numeric)` }).from(orderRecoveryObservations).where(and(eq(orderRecoveryObservations.accountId, a.id), eq(orderRecoveryObservations.intentId, i.id), eq(orderRecoveryObservations.kind, "observed"), eq(orderRecoveryObservations.disposition, "applied")));
            if (prior && (evidence.filledBase !== null && prior.filled !== null && compareAmounts(parseAmount(evidence.filledBase), parseAmount(prior.filled)) < 0 || evidence.feeQuote !== null && prior.fee !== null && compareAmounts(parseAmount(evidence.feeQuote), parseAmount(prior.fee)) < 0 || evidence.remainingBase !== null && prior.remaining !== null && compareAmounts(parseAmount(evidence.remainingBase), parseAmount(prior.remaining)) > 0))
              disposition = "conflict";
          }
        }
        const now = time();
        if (now < ticket.startedAt)
          throw new RecoveryError("unavailable");
        await tx.insert(orderRecoveryObservations).values({ readId: ticket.id, accountId: a.id, intentId: i.id, kind, disposition, evidence, observationHash: hash, observedAt: now, source: "contract_fixture" });
        let updated = i;
        // An indeterminate poll cannot distinguish a crashed callback from the
        // original callback still signing/waiting. Do not revoke its first send.
        const indeterminateSubmission = i.state === "SUBMITTING" && ["initialized", "not_found", "unavailable"].includes(kind);
        if (disposition !== "ignored" && !indeterminateSubmission) {
          // Reading provider status cannot clear an operator review requirement.
          const state = i.state === "MANUAL_REVIEW" ? i.state : disposition === "applied" && mapped ? mapped : i.state === "SUBMITTING" ? "UNKNOWN" : i.state;
          const [next] = await tx.update(investmentIntents).set({ state, revision: i.revision + 1, updatedAt: now }).where(and(eq(investmentIntents.id, i.id), eq(investmentIntents.revision, i.revision), eq(investmentIntents.state, i.state))).returning();
          if (!next)
            throw new RecoveryError("conflict");
          updated = next;
        }
        await tx.insert(auditEvents).values({ accountId: a.id, intentId: i.id, actorId: ctx.ownerId, eventType: "order_recovery_recorded", metadata: { readId: ticket.id, kind, disposition, source: "contract_fixture" }, occurredAt: now });
        return view(tx, a, updated);
      });
    },
  };
}
