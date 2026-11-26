import "server-only";
import {and,desc,eq,sql} from "drizzle-orm";
import {createHash} from "node:crypto";
import {auditEvents,balanceSnapshots,disposalApprovals,disposalDispatches,disposalOutcomes,disposalReadObservations,disposalReads,disposalSendAuthorizations} from "../../server/db/schema";
import type {OwnerContext} from "../identity/access.server";
import type {DisposalStore,SaleAccount,SaleIntent,SaleTx} from "./disposal-store.server";
import {ApprovalError} from "./approval-types";
import {currentSaleReview} from "./disposal-review-record.server";
import {normalizeSaleWallet} from "./disposal-wallet";
import {projectSaleOrderEvidence,saleRecoveryView} from "./disposal-recovery.server";
import {revalidateDisposalReview} from "./disposal-review";
import {isTerminalState} from "./outcome-history.server";
import {quantity} from "./disposal-validation";
export async function approvedSaleWallet(store:DisposalStore,tx:SaleTx,ctx:OwnerContext,a:SaleAccount,i:SaleIntent){
 const [approval]=await tx.select().from(disposalApprovals).where(and(eq(disposalApprovals.accountId,a.id),eq(disposalApprovals.intentId,i.id),eq(disposalApprovals.ownerId,ctx.ownerId)));
 if(!approval)throw new ApprovalError("conflict");const review=await currentSaleReview(store,tx,ctx,a,i);
 if(approval.termsHash!==review.view.termsHash||approval.reviewRevision!==review.view.revision||approval.source!=="contract_fixture")throw new ApprovalError("conflict");
 const [read]=await tx.select().from(disposalReads).where(and(eq(disposalReads.id,approval.holdingReadId),eq(disposalReads.intentId,i.id),eq(disposalReads.accountId,a.id),eq(disposalReads.purpose,"approval")));
 const [obs]=await tx.select().from(disposalReadObservations).where(and(eq(disposalReadObservations.readId,approval.holdingReadId),eq(disposalReadObservations.intentId,i.id),eq(disposalReadObservations.accountId,a.id)));
 const [cash]=await tx.select().from(balanceSnapshots).where(and(eq(balanceSnapshots.id,approval.cashBaselineId),eq(balanceSnapshots.accountId,a.id)));
 if(!read||!obs||!cash||obs.disposition!=="applied"||read.startedAt<review.row.createdAt||obs.recordedAt<read.startedAt||obs.recordedAt>approval.approvedAt||cash.source!=="fixture"||cash.listingId!==store.assets.cash.id||cash.chain!=="solana"||cash.venue!=="defi")throw new ApprovalError("conflict");
 const evidence=normalizeSaleWallet(obs.evidence,review.view.terms.review.binding);
 if(createHash("sha256").update(JSON.stringify(evidence)).digest("hex")!==obs.observationHash||evidence.holding.observedAt!==read.startedAt.toISOString()||evidence.cash.observedAt!==read.startedAt.toISOString()||cash.observedAt.getTime()!==read.startedAt.getTime()||quantity(cash.available,6)!==evidence.cash.available||evidence.cash.held!=="0")throw new ApprovalError("conflict");
 revalidateDisposalReview(review.view.terms.review,store.binding(ctx,a,i),evidence.holding,approval.approvedAt);
 return {approval,review,evidence};
}
export async function saleSettlementBasis(store:DisposalStore,tx:SaleTx,ctx:OwnerContext,a:SaleAccount,i:SaleIntent){
 if(!isTerminalState(i.state)||!i.effectsPossible||a.activeOperationId!==i.id)throw new ApprovalError("conflict");
 const before=await approvedSaleWallet(store,tx,ctx,a,i),view=await saleRecoveryView(tx,a,i);if(view.requiresManualReview)throw new ApprovalError("conflict");
 const [known]=await tx.select({outcome:disposalOutcomes,read:disposalReads}).from(disposalOutcomes).innerJoin(disposalReads,eq(disposalReads.id,disposalOutcomes.readId)).where(and(eq(disposalOutcomes.accountId,a.id),eq(disposalOutcomes.intentId,i.id),eq(disposalOutcomes.kind,"observed"),eq(disposalOutcomes.disposition,"applied"))).orderBy(desc(disposalReads.sequence)).limit(1);
 const [latest]=await tx.select({id:disposalReads.id}).from(disposalReads).where(and(eq(disposalReads.accountId,a.id),eq(disposalReads.intentId,i.id),eq(disposalReads.purpose,"order"))).orderBy(desc(disposalReads.sequence)).limit(1);
 const [dispatch]=await tx.select().from(disposalDispatches).where(and(eq(disposalDispatches.attemptId,before.approval.attemptId),eq(disposalDispatches.accountId,a.id),eq(disposalDispatches.intentId,i.id)));
 const [send]=await tx.select().from(disposalSendAuthorizations).where(and(eq(disposalSendAuthorizations.attemptId,before.approval.attemptId),eq(disposalSendAuthorizations.accountId,a.id),eq(disposalSendAuthorizations.intentId,i.id)));
 const [done]=await tx.select({at:auditEvents.occurredAt}).from(auditEvents).where(and(eq(auditEvents.accountId,a.id),eq(auditEvents.intentId,i.id),eq(auditEvents.eventType,"execution_observed"),sql`${auditEvents.metadata}->>'attemptId'=${before.approval.attemptId}`)).orderBy(desc(auditEvents.sequence)).limit(1);
 if(!known||latest?.id!==known.read.id||!dispatch||!send||!done||known.read.approvalId!==before.approval.id||known.read.startedAt<send.authorizedAt||known.outcome.observedAt<known.read.startedAt||dispatch.claimedAt<before.approval.approvedAt||send.authorizedAt<dispatch.claimedAt)throw new ApprovalError("conflict");
 const actual=projectSaleOrderEvidence(known.outcome.evidence,before.review.view.terms.review.binding,i.providerOrderId!,i.requestedQty);
 if(actual.providerStatus.toUpperCase()!==i.state||actual.filledBase===null||actual.remainingBase===null||actual.grossQuote===null||actual.feeQuote===null)throw new ApprovalError("conflict");
 return {...before,known,actual,send,doneAt:done.at};
}
