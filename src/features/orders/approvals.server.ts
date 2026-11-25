import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { DatabaseError, type getDatabase } from "../../server/db";
import { auditEvents, balanceSnapshots, calculationSnapshots, commitments, executionAttempts, gatewayAccounts, investmentIntents, orderApprovals, orderReviews, planningPolicies, profiles } from "../../server/db/schema";
import type { OwnerContext } from "../identity/access.server";
import { calculateAllowance } from "../planning/calculate-allowance";
import { compareAmounts, parseAmount, subtractAmounts } from "../planning/money";
import { localDateAt, validateTimezone } from "../planning/validation";
import { normalizeApprovalCommand } from "./approval-command";
import { ApprovalError, type ApprovalCommand, type ApprovalReceipt, type FixtureApprovalEvidence } from "./approval-types";
import { projectStoredReview } from "./reviews.server";
import { isUuid } from "../../server/env";

type Tx = Parameters<Parameters<ReturnType<typeof getDatabase>["withOwner"]>[1]>[0];
type Account = typeof gatewayAccounts.$inferSelect;
type Intent = typeof investmentIntents.$inferSelect;
type Approval = typeof orderApprovals.$inferSelect;
type Attempt = typeof executionAttempts.$inferSelect;

function receipt(approval: Approval, attempt: Attempt, intent: Intent, accepted: boolean): ApprovalReceipt {
  return Object.freeze({ intentId: intent.id, approvalId: approval.id, attemptId: attempt.id,
    reviewRevision: approval.reviewRevision, termsHash: approval.termsHash, approvedAt: approval.approvedAt.toISOString(),
    state: intent.state, source: "contract_fixture", accepted, canExecute: false });
}
function freshEvidence(value: unknown, accountId: string, listingId: string, now: Date): FixtureApprovalEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApprovalError("stale_inputs");
  const v = value as FixtureApprovalEvidence;
  const observed = typeof v.observedAt === "string" ? Date.parse(v.observedAt) : NaN, age = now.getTime() - observed;
  if (v.source !== "contract_fixture" || v.accountId !== accountId || v.listingId !== listingId || v.chain !== "solana" || v.venue !== "defi" ||
      !Number.isFinite(observed) || new Date(observed).toISOString() !== v.observedAt || age < 0 || age > 15000) throw new ApprovalError("stale_inputs");
  return { source: "contract_fixture", accountId, listingId, chain: "solana", venue: "defi", available: parseAmount(v.available), observedAt: v.observedAt };
}

/** Only a local fixture harness may opt in. No environment setting enables this repository. */
export function createApprovalRepository(database: ReturnType<typeof getDatabase>, options: { clock: () => Date; fixtureMode?: boolean; fixtureApprovalEnabled?: boolean }) {
  function enabled() {
    if (options.fixtureMode !== true || options.fixtureApprovalEnabled !== true) throw new ApprovalError("disabled");
  }
  function currentTime() {
    const now = options.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new ApprovalError("unavailable");
    return new Date(now);
  }
  async function transaction<T>(context: OwnerContext, command: ApprovalCommand, work: (tx: Tx, account: Account, intent: Intent, now: Date) => Promise<T>): Promise<T> {
    enabled();
    let domain: ApprovalError | undefined;
    try {
      return await database.withOwner(context.ownerId, async tx => {
        try {
          await tx.execute(sql`SET LOCAL lock_timeout='3s'`);
          await tx.execute(sql`SET LOCAL statement_timeout='5s'`);
          const [account] = await tx.select().from(gatewayAccounts).where(and(eq(gatewayAccounts.id, context.accountId), eq(gatewayAccounts.ownerId, context.ownerId))).for("update");
          enabled(); // Recheck controls after any wait for the account lock.
          if (!account || account.externalRefId !== context.externalRefId) throw new ApprovalError("not_found");
          const [intent] = await tx.select().from(investmentIntents).where(and(eq(investmentIntents.id, command.intentId), eq(investmentIntents.accountId, account.id)));
          if (!intent) throw new ApprovalError("not_found");
          return await work(tx, account, intent, currentTime());
        } catch (error) {
          if (error instanceof ApprovalError) { domain = error; throw new DatabaseError("operation_failed"); }
          throw error;
        }
      });
    } catch {
      if (domain) throw domain;
      throw new ApprovalError("unavailable");
    }
  }
  async function existing(tx: Tx, context: OwnerContext, command: ApprovalCommand, intent: Intent) {
    const [approval] = await tx.select().from(orderApprovals).where(and(eq(orderApprovals.intentId, intent.id), eq(orderApprovals.accountId, context.accountId)));
    if (!approval) return null;
    if (approval.reviewRevision !== command.reviewRevision || approval.termsHash !== command.termsHash || approval.ownerId !== context.ownerId || approval.source !== "contract_fixture") throw new ApprovalError("conflict");
    const [attempt] = await tx.select().from(executionAttempts).where(and(eq(executionAttempts.approvalId, approval.id), eq(executionAttempts.intentId, intent.id), eq(executionAttempts.accountId, context.accountId)));
    if (!attempt || attempt.source !== "contract_fixture") throw new ApprovalError("unavailable");
    // Observation only: a replay cannot dispatch, restore a slot or restart work.
    return receipt(approval, attempt, intent, false);
  }
  return {
    async get(context: OwnerContext, value: unknown): Promise<ApprovalReceipt | null> {
      const command = normalizeApprovalCommand(value);
      return transaction(context, command, (tx, _account, intent) => existing(tx, context, command, intent));
    },
    async approve(context: OwnerContext, value: unknown, observation: unknown): Promise<ApprovalReceipt> {
      enabled();
      const command = normalizeApprovalCommand(value);
      let captured: unknown;
      try { captured = structuredClone(observation); } catch { throw new ApprovalError("stale_inputs"); }
      return transaction(context, command, async (tx, account, intent, now) => {
        const replay = await existing(tx, context, command, intent);
        if (replay) return replay;
        if (account.activeOperationId !== intent.id || intent.state !== "REVIEW_READY" || intent.effectsPossible || intent.preparationSafety !== "contract_fixture" ||
            intent.operationKind !== "buy" || intent.qtyUnit !== "quote" || !intent.calculationId || account.provisioningState !== "READY" || !account.providerUserId) throw new ApprovalError("conflict");
        // Approval needs terms, never the encrypted unsigned payloads or signer key.
        const [review] = await tx.select({ intentId: orderReviews.intentId, revision: orderReviews.revision, terms: orderReviews.terms, termsHash: orderReviews.termsHash, maximumDebit: orderReviews.maximumDebit, expiresAt: orderReviews.expiresAt })
          .from(orderReviews).where(and(eq(orderReviews.intentId, intent.id), eq(orderReviews.accountId, account.id), eq(orderReviews.revision, command.reviewRevision)));
        if (!review || review.termsHash !== command.termsHash || review.revision !== intent.preparationGeneration ||
            !intent.reviewExpiresAt || review.expiresAt.getTime() !== intent.reviewExpiresAt.getTime() || review.expiresAt <= now) throw new ApprovalError("conflict");
        const reviewed = projectStoredReview(review), binding = review.terms.binding;
        if (binding.accountId !== account.id || binding.intentId !== intent.id || binding.generation !== intent.preparationGeneration ||
            binding.policyRevision !== intent.policyRevision || binding.calculationId !== intent.calculationId ||
            reviewed.providerOrderId !== intent.providerOrderId || reviewed.quote.stockId !== intent.assetId || reviewed.quote.requestedAmount !== parseAmount(intent.requestedQty)) throw new ApprovalError("conflict");
        const [calculation] = await tx.select().from(calculationSnapshots).where(and(eq(calculationSnapshots.id, intent.calculationId), eq(calculationSnapshots.accountId, account.id)));
        const [profile] = await tx.select({ timezone: profiles.timezone }).from(profiles).where(eq(profiles.authUserId, context.ownerId)).for("share");
        const [policy] = await tx.select().from(planningPolicies).where(eq(planningPolicies.accountId, account.id));
        if (!calculation || !profile || !policy || account.policyRevision !== intent.policyRevision || calculation.policyRevision !== intent.policyRevision || policy.revision !== intent.policyRevision ||
            calculation.input.timezone !== profile.timezone ||
            policy.horizonDays !== calculation.input.horizonDays || parseAmount(policy.additionalBuffer) !== parseAmount(calculation.input.additionalBuffer)) throw new ApprovalError("stale_inputs");
        const [original] = await tx.select().from(balanceSnapshots).where(and(eq(balanceSnapshots.id, calculation.balanceSnapshotId), eq(balanceSnapshots.accountId, account.id)));
        const [latest] = await tx.select({ id: balanceSnapshots.id }).from(balanceSnapshots).where(eq(balanceSnapshots.accountId, account.id)).orderBy(desc(balanceSnapshots.sequence)).limit(1);
        if (!original || latest?.id !== original.id || original.source !== "fixture" || original.chain !== "solana" || original.venue !== "defi" || original.listingId !== reviewed.quote.cashId ||
            parseAmount(original.available) !== parseAmount(calculation.input.available)) throw new ApprovalError("stale_inputs");
        const savedCommitments = await tx.select().from(commitments).where(eq(commitments.accountId, account.id));
        // All prerequisite reads/locks have completed. The earlier account-lock
        // time cannot authorize after a later profile lock wait or slow query.
        enabled();
        const decisionAt = currentTime();
        if (review.expiresAt <= decisionAt) throw new ApprovalError("conflict");
        if (calculation.input.asOfLocalDate !== localDateAt(decisionAt, validateTimezone(profile.timezone))) throw new ApprovalError("stale_inputs");
        const fresh = freshEvidence(captured, account.id, original.listingId, decisionAt);
        if (Date.parse(fresh.observedAt) < original.observedAt.getTime()) throw new ApprovalError("stale_inputs");
        const result = calculateAllowance({ available: fresh.available, commitments: savedCommitments, additionalBuffer: policy.additionalBuffer,
          asOfLocalDate: calculation.input.asOfLocalDate, horizonDays: policy.horizonDays, policyRevision: account.policyRevision });
        if (fresh.available !== reviewed.cash.available || fresh.available !== parseAmount(original.available) ||
            result.commitmentsTotal !== reviewed.cash.commitments || result.additionalBuffer !== reviewed.cash.buffer || result.debitBudget !== reviewed.cash.debitBudget ||
            compareAmounts(parseAmount(reviewed.maximumDebit), result.debitBudget) > 0 ||
            subtractAmounts(parseAmount(fresh.available), parseAmount(reviewed.maximumDebit)) !== reviewed.cash.afterMaximumDebit) throw new ApprovalError("stale_inputs");
        const [balance] = await tx.insert(balanceSnapshots).values({ accountId: account.id, source: "fixture", listingId: fresh.listingId, chain: fresh.chain, venue: fresh.venue, available: fresh.available, observedAt: new Date(fresh.observedAt) }).returning();
        const [approval] = await tx.insert(orderApprovals).values({ accountId: account.id, intentId: intent.id, ownerId: context.ownerId, reviewRevision: review.revision, termsHash: command.termsHash, balanceSnapshotId: balance.id, source: "contract_fixture", approvedAt: decisionAt }).returning();
        const [attempt] = await tx.insert(executionAttempts).values({ accountId: account.id, intentId: intent.id, approvalId: approval.id, source: "contract_fixture", startedAt: decisionAt }).returning();
        const [updated] = await tx.update(investmentIntents).set({ state: "SUBMITTING", effectsPossible: true, revision: intent.revision + 1, updatedAt: decisionAt })
          .where(and(eq(investmentIntents.id, intent.id), eq(investmentIntents.revision, intent.revision), eq(investmentIntents.state, "REVIEW_READY"), eq(investmentIntents.preparationGeneration, review.revision), eq(investmentIntents.effectsPossible, false))).returning();
        if (!updated) throw new ApprovalError("conflict");
        await tx.insert(auditEvents).values({ accountId: account.id, intentId: intent.id, actorId: context.ownerId, eventType: "approval_recorded",
          metadata: { approvalId: approval.id, attemptId: attempt.id, reviewRevision: review.revision, termsHash: command.termsHash, source: "contract_fixture" }, occurredAt: decisionAt });
        return receipt(approval, attempt, updated, true);
      });
    },
    /** Internal completion of a failed fixture handoff. Never an age-based unlock. */
    async markFixtureUnknown(context: OwnerContext, value: unknown, attemptId: string): Promise<ApprovalReceipt> {
      const command = normalizeApprovalCommand(value);
      if (!isUuid(attemptId)) throw new ApprovalError("invalid_request");
      return transaction(context, command, async (tx, account, intent, now) => {
        const claim = await existing(tx, context, command, intent);
        if (!claim || claim.attemptId !== attemptId) throw new ApprovalError("not_found");
        if (intent.state !== "SUBMITTING") return claim;
        if (account.activeOperationId !== intent.id || !intent.effectsPossible) throw new ApprovalError("conflict");
        const [updated] = await tx.update(investmentIntents).set({ state: "UNKNOWN", revision: intent.revision + 1, updatedAt: now })
          .where(and(eq(investmentIntents.id, intent.id), eq(investmentIntents.revision, intent.revision), eq(investmentIntents.state, "SUBMITTING"))).returning();
        if (!updated) throw new ApprovalError("conflict");
        await tx.insert(auditEvents).values({ accountId: account.id, intentId: intent.id, actorId: context.ownerId,
          eventType: "fixture_handoff_unknown", metadata: { attemptId, source: "contract_fixture" }, occurredAt: now });
        return Object.freeze({ ...claim, state: updated.state });
      });
    },
  };
}
