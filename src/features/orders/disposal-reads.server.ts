import "server-only";
import {and,desc,eq} from "drizzle-orm";
import {createHash} from "node:crypto";
import {disposalReads,disposalReadObservations,disposalApprovals,disposalDispatches,disposalSendAuthorizations,balanceSnapshots} from "../../server/db/schema";
import type {OwnerContext} from "../identity/access.server";
import type {SaleReadPurpose,SaleReadTicket,SaleWalletEvidence} from "./disposal-store-types";
import {saleIntent,type DisposalStore,type SaleTx,type SaleAccount,type SaleIntent} from "./disposal-store.server";
import {saleSettlementBasis} from "./disposal-settlement-basis.server";
import {currentSaleReview} from "./disposal-review-record.server";
import {ApprovalError} from "./approval-types";
import {fresh,matchBinding,normalizeDisposalBinding,uuid} from "./disposal-validation";
import {hasSalePreparationAttempt} from "./sale-preparation-history.server";
export {normalizeSaleWallet} from "./disposal-wallet";
import {normalizeSaleWallet} from "./disposal-wallet";
function ticket(r:typeof disposalReads.$inferSelect,i:SaleIntent):SaleReadTicket{return {id:r.id,purpose:r.purpose,intentId:r.intentId,intentRevision:r.intentRevision,generation:r.generation,binding:normalizeDisposalBinding(r.binding),startedAt:r.startedAt.toISOString(),providerOrderId:i.providerOrderId,approvalId:r.approvalId,orderReadId:r.orderReadId,cashBaselineId:r.cashBaselineId};}
export async function loadSaleWallet(store:DisposalStore,tx:SaleTx,ctx:OwnerContext,a:SaleAccount,i:SaleIntent,id:string,purpose:SaleReadPurpose) {
 const [r]=await tx.select().from(disposalReads).where(and(eq(disposalReads.id,uuid(id)),eq(disposalReads.intentId,i.id),eq(disposalReads.accountId,a.id)));
 const [o]=await tx.select().from(disposalReadObservations).where(and(eq(disposalReadObservations.readId,uuid(id)),eq(disposalReadObservations.intentId,i.id),eq(disposalReadObservations.accountId,a.id)));
 const [latest]=await tx.select({id:disposalReads.id}).from(disposalReads).where(and(eq(disposalReads.accountId,a.id),eq(disposalReads.intentId,i.id),eq(disposalReads.purpose,purpose))).orderBy(desc(disposalReads.sequence)).limit(1);
 if(!r||!o||r.purpose!==purpose||o.disposition!=="applied"||latest?.id!==r.id||r.intentRevision!==i.revision||r.generation!==i.preparationGeneration)throw new ApprovalError("conflict");
 const binding=store.binding(ctx,a,i);matchBinding(r.binding,binding);const evidence=normalizeSaleWallet(o.evidence,binding),now=store.clock();
 if(o.recordedAt<r.startedAt||o.recordedAt>now||evidence.holding.observedAt!==r.startedAt.toISOString()||evidence.cash.observedAt!==r.startedAt.toISOString())throw new ApprovalError("conflict");
 fresh(r.startedAt.toISOString(),now.getTime());return {read:r,evidence};
}
export function createDisposalReads(store:DisposalStore){return {
 async begin(ctx:OwnerContext,intentId:string,purpose:SaleReadPurpose):Promise<SaleReadTicket>{
  const readOnly=purpose==="order"||purpose==="settlement";if(readOnly)store.readEnabled();
  return store.transaction(ctx,async(tx,a)=>{
   if(readOnly)store.readEnabled();
   const i=await saleIntent(tx,a,intentId),binding=store.binding(ctx,a,i);
   if(purpose==="prepare"&&await hasSalePreparationAttempt(tx,a.id,i.id,i.preparationGeneration))throw new ApprovalError("conflict");
   if(purpose!=="prepare"&&purpose!=="approval"&&purpose!=="send"&&purpose!=="order"&&purpose!=="settlement")throw new ApprovalError("disabled");
   let approvalId:string|null=null,orderReadId:string|null=null,cashBaselineId:string|null=null;
   if(purpose==="send"||purpose==="order"){
    const [approval]=await tx.select().from(disposalApprovals).where(and(eq(disposalApprovals.accountId,a.id),eq(disposalApprovals.intentId,i.id)));
    const [dispatch]=approval?await tx.select().from(disposalDispatches).where(and(eq(disposalDispatches.attemptId,approval.attemptId),eq(disposalDispatches.accountId,a.id),eq(disposalDispatches.intentId,i.id))):[];
    const [authorized]=approval?await tx.select().from(disposalSendAuthorizations).where(and(eq(disposalSendAuthorizations.attemptId,approval.attemptId),eq(disposalSendAuthorizations.accountId,a.id),eq(disposalSendAuthorizations.intentId,i.id))):[];
    if(purpose==="order"&&!authorized)throw new ApprovalError("conflict");
    if(!approval||approval.ownerId!==ctx.ownerId||!i.effectsPossible||purpose==="send"&&(!dispatch||i.state!=="SUBMITTING")||purpose==="order"&&!["SUBMITTING","PENDING","UNKNOWN","MANUAL_REVIEW","COMPLETE","FAILED","CANCELED"].includes(i.state))throw new ApprovalError("conflict");
    const saved=await currentSaleReview(store,tx,ctx,a,i);if(saved.view.termsHash!==approval.termsHash||saved.view.revision!==approval.reviewRevision)throw new ApprovalError("conflict");approvalId=approval.id;
   }
   if(purpose==="settlement"){
    const basis=await saleSettlementBasis(store,tx,ctx,a,i),[baseline]=await tx.select({id:balanceSnapshots.id}).from(balanceSnapshots).where(eq(balanceSnapshots.accountId,a.id)).orderBy(desc(balanceSnapshots.sequence)).limit(1);
    const at=store.clock();if(!baseline||at<basis.known.outcome.observedAt||at<basis.doneAt)throw new ApprovalError("conflict");approvalId=basis.approval.id;orderReadId=basis.known.read.id;cashBaselineId=baseline.id;
   }
   const now=store.clock();
   if(purpose==="prepare"&&(i.state!=="PREPARING"||i.effectsPossible||!i.preparationLeaseUntil||i.preparationLeaseUntil<=now)||(purpose==="approval"||purpose==="send")&&(!i.reviewExpiresAt||i.reviewExpiresAt<=now)||purpose==="approval"&&(i.state!=="REVIEW_READY"||i.effectsPossible))throw new ApprovalError("conflict");
   const rows=await tx.insert(disposalReads).values({accountId:a.id,intentId:i.id,purpose,intentRevision:i.revision,generation:i.preparationGeneration,binding,approvalId,orderReadId,cashBaselineId,startedAt:now,source:"contract_fixture"}).returning();
   if(rows.length!==1)throw new ApprovalError("conflict");return ticket(rows[0],i);
  },readOnly);
 },
 async record(ctx:OwnerContext,readId:string,value:unknown):Promise<{accepted:boolean;readId:string;evidence:SaleWalletEvidence}>{
  const input=structuredClone(value);
  return store.transaction(ctx,async(tx,a)=>{
   const [r]=await tx.select().from(disposalReads).where(and(eq(disposalReads.id,uuid(readId)),eq(disposalReads.accountId,a.id)));if(!r)throw new ApprovalError("not_found");
   if(r.purpose!=="prepare"&&r.purpose!=="approval"&&r.purpose!=="send"&&r.purpose!=="settlement")throw new ApprovalError("disabled");
   const i=await saleIntent(tx,a,r.intentId,false),evidence=normalizeSaleWallet(input,normalizeDisposalBinding(r.binding)),now=store.clock();
   if(now<r.startedAt||evidence.holding.observedAt!==r.startedAt.toISOString()||evidence.cash.observedAt!==r.startedAt.toISOString())throw new ApprovalError("stale_inputs");
   const hash=createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
   const [old]=await tx.select().from(disposalReadObservations).where(and(eq(disposalReadObservations.readId,r.id),eq(disposalReadObservations.accountId,a.id)));
   if(old){if(old.observationHash!==hash)throw new ApprovalError("conflict");return {accepted:old.disposition==="applied",readId:r.id,evidence};}
   const [last]=await tx.select({id:disposalReads.id}).from(disposalReads).where(and(eq(disposalReads.accountId,a.id),eq(disposalReads.intentId,i.id),eq(disposalReads.purpose,r.purpose))).orderBy(desc(disposalReads.sequence)).limit(1);
   let matches=false;try{matchBinding(r.binding,store.binding(ctx,a,i));matches=true;}catch{}
   const accepted=matches&&a.activeOperationId===i.id&&r.intentRevision===i.revision&&r.generation===i.preparationGeneration&&last?.id===r.id&&now.getTime()-r.startedAt.getTime()<=15000;
   const rows=await tx.insert(disposalReadObservations).values({readId:r.id,accountId:a.id,intentId:i.id,purpose:r.purpose,evidence,observationHash:hash,disposition:accepted?"applied":"ignored",recordedAt:now}).returning({id:disposalReadObservations.readId});if(rows.length!==1)throw new ApprovalError("conflict");
   return {accepted,readId:r.id,evidence};
  },true);
 }
};}
