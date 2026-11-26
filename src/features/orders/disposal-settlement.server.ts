import "server-only";
import {and,desc,eq} from "drizzle-orm";
import {createHash} from "node:crypto";
import {balanceSnapshots,disposalSettlements,disposalReviews,gatewayAccounts} from "../../server/db/schema";
import type {OwnerContext} from "../identity/access.server";
import {saleAudit,saleIntent,type DisposalStore} from "./disposal-store.server";
import type {DisposalReconciliation} from "./disposal-types";
import {ApprovalError} from "./approval-types";
import {saleSettlementBasis} from "./disposal-settlement-basis.server";
import {loadSaleWallet} from "./disposal-reads.server";
import {reconcileDisposalFixture} from "./disposal-settlement";
import {projectDisposalReconciliation} from "./disposal-reconciliation-view";
import {projectStoredSaleReview,saleReviewSelection} from "./disposal-review-record.server";
import {quantity,record,uuid} from "./disposal-validation";
function command(value:unknown){
 const r=record(structuredClone(value),["intentId","walletReadId","requestKey","otherBaseCredits","otherBaseDebits","otherQuoteCredits","otherQuoteDebits","references"]),refs=record(r.references,["order","balance","stock","wallet"]);
 for(const ref of Object.values(refs)){if(typeof ref!=="string"||!/^fixture:[A-Za-z0-9_-]{1,128}$/.test(ref))throw new ApprovalError("invalid_request");}
 return {intentId:uuid(r.intentId),walletReadId:uuid(r.walletReadId),requestKey:uuid(r.requestKey),otherBaseCredits:quantity(r.otherBaseCredits,18),otherBaseDebits:quantity(r.otherBaseDebits,18),otherQuoteCredits:quantity(r.otherQuoteCredits,6),otherQuoteDebits:quantity(r.otherQuoteDebits,6),references:{order:refs.order as string,balance:refs.balance as string,stock:refs.stock as string,wallet:refs.wallet as string}};
}
export function createDisposalSettlement(store:DisposalStore){return {async clear(ctx:OwnerContext,value:unknown):Promise<{intentId:string;verified:true;released:boolean;replayed:boolean;result:DisposalReconciliation;canExecute:false}>{
 const input=command(value),hash=createHash("sha256").update(JSON.stringify(["harborline-sale-clearance-v2",input])).digest("hex");
 return store.transaction(ctx,async(tx,a)=>{
  const i=await saleIntent(tx,a,input.intentId,false),[byKey]=await tx.select().from(disposalSettlements).where(and(eq(disposalSettlements.accountId,a.id),eq(disposalSettlements.requestKey,input.requestKey))),[byIntent]=await tx.select().from(disposalSettlements).where(and(eq(disposalSettlements.accountId,a.id),eq(disposalSettlements.intentId,i.id)));
  const old=byKey??byIntent;
  if(old){if(old.intentId!==i.id||old.proofHash!==hash)throw new ApprovalError("conflict");const [saved]=await tx.select(saleReviewSelection).from(disposalReviews).where(and(eq(disposalReviews.intentId,i.id),eq(disposalReviews.accountId,a.id),eq(disposalReviews.revision,i.preparationGeneration)));if(!saved)throw new ApprovalError("unavailable");const review=projectStoredSaleReview(saved);return {intentId:i.id,verified:true,released:false,replayed:true,result:projectDisposalReconciliation(old.result,review.terms.binding.baseDecimals),canExecute:false};}
  const basis=await saleSettlementBasis(store,tx,ctx,a,i),wallet=await loadSaleWallet(store,tx,ctx,a,i,input.walletReadId,"settlement"),[latestCash]=await tx.select({id:balanceSnapshots.id}).from(balanceSnapshots).where(eq(balanceSnapshots.accountId,a.id)).orderBy(desc(balanceSnapshots.sequence)).limit(1);
  if(wallet.read.approvalId!==basis.approval.id||wallet.read.orderReadId!==basis.known.read.id||!wallet.read.cashBaselineId||wallet.read.cashBaselineId!==latestCash?.id||wallet.read.startedAt<basis.known.outcome.observedAt||wallet.read.startedAt<basis.doneAt||input.references.order!=="fixture:"+basis.review.view.terms.review.quote.providerOrderId||input.references.balance!=="fixture:"+wallet.read.id||input.references.stock!=="fixture:"+wallet.read.id)throw new ApprovalError("conflict");
  const now=store.clock();store.enabled();
  const result=reconcileDisposalFixture(basis.review.view.terms.review,{source:"contract_fixture",binding:basis.review.view.terms.review.binding,providerOrderId:i.providerOrderId,status:basis.actual.providerStatus,filledBase:basis.actual.filledBase,remainingBase:basis.actual.remainingBase,grossQuote:basis.actual.grossQuote,feeQuote:basis.actual.feeQuote,averagePriceQuote:basis.actual.averagePriceQuote,observedAt:basis.known.outcome.observedAt.toISOString()},{source:"contract_fixture",binding:basis.review.view.terms.review.binding,providerOrderId:i.providerOrderId,cashBefore:basis.evidence.cash,cashAfter:wallet.evidence.cash,stockAfter:wallet.evidence.holding,otherBaseCredits:input.otherBaseCredits,otherBaseDebits:input.otherBaseDebits,otherQuoteCredits:input.otherQuoteCredits,otherQuoteDebits:input.otherQuoteDebits},now,{approvedAt:basis.approval.approvedAt.toISOString(),holding:basis.evidence.holding,cash:basis.evidence.cash});
  const baseline=await tx.insert(balanceSnapshots).values({accountId:a.id,source:"fixture",listingId:store.assets.cash.id,chain:"solana",venue:"defi",available:result.cashAfter,observedAt:wallet.read.startedAt}).returning({id:balanceSnapshots.id});if(baseline.length!==1)throw new ApprovalError("conflict");
  const proof=await tx.insert(disposalSettlements).values({accountId:a.id,intentId:i.id,approvalId:basis.approval.id,orderReadId:basis.known.read.id,walletReadId:wallet.read.id,baselineId:baseline[0].id,operatorId:store.enabled(),requestKey:input.requestKey,proofHash:hash,references:input.references,result,verifiedAt:now,source:"contract_fixture"}).returning({id:disposalSettlements.id});if(proof.length!==1)throw new ApprovalError("conflict");
  const released=await tx.update(gatewayAccounts).set({activeOperationId:null}).where(and(eq(gatewayAccounts.id,a.id),eq(gatewayAccounts.activeOperationId,i.id))).returning({id:gatewayAccounts.id});if(released.length!==1)throw new ApprovalError("conflict");
  await saleAudit(tx,ctx,i.id,"sale_settlement_verified",{orderReadId:basis.known.read.id,walletReadId:wallet.read.id,settlementId:proof[0].id,released:true},now);
  return {intentId:i.id,verified:true,released:true,replayed:false,result,canExecute:false};
 });
}};}
