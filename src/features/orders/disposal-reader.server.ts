import "server-only";
import {and,desc,eq} from "drizzle-orm";
import {createHash} from "node:crypto";
import {balanceSnapshots,disposalApprovals,disposalOutcomes,disposalReadObservations,disposalReads,disposalReviews,disposalSettlements} from "../../server/db/schema";
import type {OwnerContext} from "../identity/access.server";
import {subtractAmounts,parseAmount} from "../planning/money";
import {ActivityError,type ActivitySummary,type OrderRecord} from "./activity-types";
import type {SaleTx} from "./disposal-store.server";
import type {SaleActivity} from "./disposal-activity-types";
import {projectStoredSaleReview,saleReviewSelection} from "./disposal-review-record.server";
import {normalizeSaleWallet} from "./disposal-wallet";
import {matchBinding,quantity} from "./disposal-validation";
import {revalidateDisposalReview} from "./disposal-review";
import {projectSaleOrderEvidence} from "./disposal-recovery.server";
import {projectDisposalReconciliation} from "./disposal-reconciliation-view";
import {reconcileDisposalFixture} from "./disposal-settlement";
/** Historical evidence is checked at its recorded time, never against today's plan or balances. */
export async function loadSaleActivity(tx:SaleTx,ctx:OwnerContext,summary:ActivitySummary,providerOrderId:string|null,generation:number,policyRevision:number):Promise<OrderRecord>{
 try{
  const owned=and(eq(disposalReviews.accountId,ctx.accountId),eq(disposalReviews.intentId,summary.id));
  const [row]=await tx.select(saleReviewSelection).from(disposalReviews).where(and(owned,eq(disposalReviews.revision,generation)));
  const [approval]=await tx.select().from(disposalApprovals).where(and(eq(disposalApprovals.accountId,ctx.accountId),eq(disposalApprovals.intentId,summary.id),eq(disposalApprovals.ownerId,ctx.ownerId)));
  const [proof]=await tx.select().from(disposalSettlements).where(and(eq(disposalSettlements.accountId,ctx.accountId),eq(disposalSettlements.intentId,summary.id)));
  const [known]=await tx.select({outcome:disposalOutcomes,read:disposalReads}).from(disposalOutcomes).innerJoin(disposalReads,eq(disposalReads.id,disposalOutcomes.readId)).where(and(eq(disposalOutcomes.accountId,ctx.accountId),eq(disposalOutcomes.intentId,summary.id),eq(disposalOutcomes.kind,"observed"),eq(disposalOutcomes.disposition,"applied"),proof?eq(disposalOutcomes.readId,proof.orderReadId):undefined)).orderBy(desc(disposalReads.sequence)).limit(1);
  const [latest]=await tx.select({at:disposalOutcomes.observedAt,kind:disposalOutcomes.kind,disposition:disposalOutcomes.disposition}).from(disposalOutcomes).innerJoin(disposalReads,eq(disposalReads.id,disposalOutcomes.readId)).where(and(eq(disposalOutcomes.accountId,ctx.accountId),eq(disposalOutcomes.intentId,summary.id))).orderBy(desc(disposalOutcomes.observedAt),desc(disposalReads.sequence)).limit(1);
  const view=row?projectStoredSaleReview(row):null,r=view?.terms.review;
  if((approval||proof||known)&&!r)throw new ActivityError("unavailable");
  if(r&&(r.binding.ownerId!==ctx.ownerId||r.binding.accountId!==ctx.accountId||r.binding.intentId!==summary.id||r.binding.policyRevision!==policyRevision||r.binding.assetId!==summary.assetId||r.requestedBase!==summary.requestedQuantity||r.quote.providerOrderId!==providerOrderId))throw new ActivityError("unavailable");
  const sale: {review:SaleActivity["review"];approval:SaleActivity["approval"];actualGrossQuote:string|null;actualNetQuote:string|null;settlement:SaleActivity["settlement"]}={review:r?{requestedBase:r.requestedBase,maximumBaseDebit:r.quote.maximumBaseDebit,expectedGrossQuote:r.quote.expectedGrossQuote,quotedFeeQuote:r.quote.quotedFeeQuote,maximumFeeQuote:r.quote.maximumFeeQuote,expectedNetQuote:r.expectedNetQuote,minimumNetQuote:r.quote.minimumNetQuote,createdAt:r.createdAt,expiresAt:r.quote.expiresAt,revision:view!.revision}:null,approval:null,actualGrossQuote:null,actualNetQuote:null,settlement:null};
  async function wallet(id:string,purpose:"approval"|"settlement"){
   const [read]=await tx.select().from(disposalReads).where(and(eq(disposalReads.id,id),eq(disposalReads.accountId,ctx.accountId),eq(disposalReads.intentId,summary.id),eq(disposalReads.purpose,purpose)));
   const [obs]=await tx.select().from(disposalReadObservations).where(and(eq(disposalReadObservations.readId,id),eq(disposalReadObservations.accountId,ctx.accountId),eq(disposalReadObservations.intentId,summary.id)));
   if(!r||!read||!obs||obs.disposition!=="applied"||obs.recordedAt<read.startedAt)throw new ActivityError("unavailable");matchBinding(read.binding,r.binding);
   const evidence=normalizeSaleWallet(obs.evidence,r.binding);
   if(createHash("sha256").update(JSON.stringify(evidence)).digest("hex")!==obs.observationHash||evidence.holding.observedAt!==read.startedAt.toISOString()||evidence.cash.observedAt!==read.startedAt.toISOString())throw new ActivityError("unavailable");return {read,obs,evidence};
  }
  const before=approval?await wallet(approval.holdingReadId,"approval"):null;
  if(approval&&before&&r){
   const [cash]=await tx.select().from(balanceSnapshots).where(and(eq(balanceSnapshots.id,approval.cashBaselineId),eq(balanceSnapshots.accountId,ctx.accountId)));
   if(approval.termsHash!==view!.termsHash||approval.reviewRevision!==view!.revision||before.obs.recordedAt>approval.approvedAt||!cash||cash.source!=="fixture"||cash.listingId!==r.binding.cashId||cash.observedAt.getTime()!==before.read.startedAt.getTime()||quantity(cash.available,6)!==before.evidence.cash.available)throw new ActivityError("unavailable");
   revalidateDisposalReview(r,r.binding,before.evidence.holding,approval.approvedAt);
   sale.approval={approvedAt:approval.approvedAt.toISOString(),stockBefore:before.evidence.holding.total,cashBefore:before.evidence.cash.available};
  }
  const actual=known&&r?projectSaleOrderEvidence(known.outcome.evidence,r.binding,providerOrderId!,r.requestedBase):null;
  if(known&&r){matchBinding(known.read.binding,r.binding);if(known.read.approvalId!==approval?.id||known.outcome.observedAt<known.read.startedAt)throw new ActivityError("unavailable");}
  sale.actualGrossQuote=actual?.grossQuote??null;
  if(actual?.grossQuote!==null&&actual?.grossQuote!==undefined&&actual.feeQuote!==null)sale.actualNetQuote=subtractAmounts(parseAmount(actual.grossQuote),parseAmount(actual.feeQuote));
  if(proof){
   if(!r||!approval||!before||!known||!actual||proof.approvalId!==approval.id)throw new ActivityError("unavailable");
   const after=await wallet(proof.walletReadId,"settlement"),saved=projectDisposalReconciliation(proof.result,r.binding.baseDecimals);
   const [baseline]=await tx.select().from(balanceSnapshots).where(and(eq(balanceSnapshots.id,proof.baselineId),eq(balanceSnapshots.accountId,ctx.accountId)));
   if(after.read.approvalId!==approval.id||after.read.orderReadId!==known.read.id||after.read.startedAt<known.outcome.observedAt||after.obs.recordedAt>proof.verifiedAt||!baseline||baseline.source!=="fixture"||baseline.listingId!==r.binding.cashId||baseline.observedAt.getTime()!==after.read.startedAt.getTime()||quantity(baseline.available,6)!==after.evidence.cash.available)throw new ActivityError("unavailable");
   const rebuilt=reconcileDisposalFixture(r,{source:"contract_fixture",binding:r.binding,providerOrderId,status:actual.providerStatus,filledBase:actual.filledBase,remainingBase:actual.remainingBase,grossQuote:actual.grossQuote,feeQuote:actual.feeQuote,averagePriceQuote:actual.averagePriceQuote,observedAt:known.outcome.observedAt.toISOString()},{source:"contract_fixture",binding:r.binding,providerOrderId,cashBefore:before.evidence.cash,cashAfter:after.evidence.cash,stockAfter:after.evidence.holding,otherBaseCredits:saved.otherBaseCredits,otherBaseDebits:saved.otherBaseDebits,otherQuoteCredits:saved.otherQuoteCredits,otherQuoteDebits:saved.otherQuoteDebits},proof.verifiedAt,{approvedAt:approval.approvedAt.toISOString(),holding:before.evidence.holding,cash:before.evidence.cash});
   if(JSON.stringify(saved)!==JSON.stringify(rebuilt))throw new ActivityError("unavailable");sale.settlement={...rebuilt,verifiedAt:proof.verifiedAt.toISOString(),balanceObservedAt:after.read.startedAt.toISOString()};
  }
  return {...summary,settlementVerified:!!sale.settlement,quoteCurrency:r?"USDC":null,providerOrderId,approval:null,settlement:null,sale,actual:actual&&known?{providerStatus:actual.providerStatus,filledBase:actual.filledBase,remainingBase:actual.remainingBase,averagePriceQuote:actual.averagePriceQuote,feeQuote:actual.feeQuote,partial:actual.partial,recordedAt:known.outcome.observedAt.toISOString()}:null,latestCheck:latest?{at:latest.at.toISOString(),kind:latest.kind,disposition:latest.disposition}:null,chainReference:null};
 }catch{throw new ActivityError("unavailable");}
}
