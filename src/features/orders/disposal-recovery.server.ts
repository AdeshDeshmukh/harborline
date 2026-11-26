import "server-only";
import {and,desc,eq,sql} from "drizzle-orm";
import {createHash} from "node:crypto";
import {auditEvents,disposalReads,disposalOutcomes,disposalApprovals,disposalReviews,disposalSettlements} from "../../server/db/schema";
import type {OwnerContext} from "../identity/access.server";
import {changeSale,saleAudit,saleIntent,type DisposalStore,type SaleTx,type SaleAccount,type SaleIntent} from "./disposal-store.server";
import type {SaleRecoveryView,SaleOrderEvidence} from "./disposal-store-types";
import {ApprovalError} from "./approval-types";
import {normalizeDisposalOrder} from "./disposal-order-contracts";
import {normalizeDisposalBinding,matchBinding,fixture,uuid,tokenQuantity} from "./disposal-validation";
import {projectStoredSaleReview,saleReviewSelection} from "./disposal-review-record.server";
import {saleTerminal} from "./disposal-outcome-history.server";
import {isTerminalState} from "./outcome-history.server";
import {compareAmounts,parseAmount} from "../planning/money";
import type {DisposalBinding} from "./disposal-types";
export function projectSaleOrderEvidence(value:unknown,binding:DisposalBinding,providerOrderId:string,requested:string):SaleOrderEvidence {
 if(!value||typeof value!=="object"||Array.isArray(value))throw new ApprovalError("unavailable");const r=value as Record<string,unknown>;
 const e=normalizeDisposalOrder({order_id:providerOrderId,asset_id:binding.assetId,qty:requested,qty_unit:"base",side:"sell",type:"market",chain:"solana",venue:"defi",quote_asset:"USDC",fee_asset:binding.cashId,status:r.providerStatus,executed_qty:r.filledBase,leaves_qty:r.remainingBase,executed_vwap:r.averagePriceQuote,fee:r.feeQuote},binding,providerOrderId,requested);
 if((r.grossQuote===null?null:tokenQuantity(r.grossQuote,6))!==e.grossQuote)throw new ApprovalError("unavailable");return e;
}
export async function saleRecoveryView(tx:SaleTx,a:SaleAccount,i:SaleIntent):Promise<SaleRecoveryView> {
 const [known]=await tx.select({row:disposalOutcomes,binding:disposalReads.binding}).from(disposalOutcomes).innerJoin(disposalReads,eq(disposalReads.id,disposalOutcomes.readId)).where(and(eq(disposalOutcomes.accountId,a.id),eq(disposalOutcomes.intentId,i.id),eq(disposalOutcomes.kind,"observed"),eq(disposalOutcomes.disposition,"applied"))).orderBy(desc(disposalReads.sequence)).limit(1);
 const [latest]=await tx.select({kind:disposalOutcomes.kind,disposition:disposalOutcomes.disposition,at:disposalOutcomes.observedAt}).from(disposalOutcomes).innerJoin(disposalReads,eq(disposalReads.id,disposalOutcomes.readId)).where(and(eq(disposalOutcomes.accountId,a.id),eq(disposalOutcomes.intentId,i.id))).orderBy(desc(disposalOutcomes.observedAt),desc(disposalReads.sequence)).limit(1);
 const [conflict]=await tx.select({id:disposalOutcomes.readId}).from(disposalOutcomes).where(and(eq(disposalOutcomes.accountId,a.id),eq(disposalOutcomes.intentId,i.id),eq(disposalOutcomes.disposition,"conflict"))).limit(1);
 const [postConflict]=await tx.select({id:auditEvents.id}).from(auditEvents).where(and(eq(auditEvents.accountId,a.id),eq(auditEvents.intentId,i.id),eq(auditEvents.eventType,"execution_observed"),sql`${auditEvents.metadata}->>'disposition'='conflict'`)).limit(1);
 const [proof]=await tx.select({id:disposalSettlements.id}).from(disposalSettlements).where(and(eq(disposalSettlements.accountId,a.id),eq(disposalSettlements.intentId,i.id)));
 return {intentId:i.id,state:i.state,evidence:known?projectSaleOrderEvidence(known.row.evidence,normalizeDisposalBinding(known.binding),i.providerOrderId!,i.requestedQty):null,actualRecordedAt:known?known.row.observedAt.toISOString():null,latest:latest?{kind:latest.kind,disposition:latest.disposition,observedAt:latest.at.toISOString()}:null,requiresManualReview:!!conflict||!!postConflict||i.state==="MANUAL_REVIEW",slotHeld:a.activeOperationId===i.id,settlementVerified:!!proof,canExecute:false,source:"contract_fixture"};
}
export function createDisposalRecovery(store:DisposalStore){return {
 async record(ctx:OwnerContext,readId:string,value:unknown):Promise<SaleRecoveryView>{
  const input=structuredClone(value) as Record<string,unknown>;if(!input||typeof input!=="object"||Array.isArray(input))throw new ApprovalError("invalid_request");fixture(input.source);
  if(!["response","unavailable","not_found"].includes(input.kind as string)||Object.keys(input).some(k=>!["source","kind",...(input.kind==="response"?["body"]:[])].includes(k)))throw new ApprovalError("invalid_request");
  return store.transaction(ctx,async(tx,a)=>{
   const [r]=await tx.select().from(disposalReads).where(and(eq(disposalReads.id,uuid(readId)),eq(disposalReads.accountId,a.id)));if(!r)throw new ApprovalError("not_found");if(r.purpose!=="order"||!r.approvalId)throw new ApprovalError("conflict");
   const i=await saleIntent(tx,a,r.intentId,false),[approval]=await tx.select().from(disposalApprovals).where(and(eq(disposalApprovals.id,r.approvalId),eq(disposalApprovals.accountId,a.id),eq(disposalApprovals.intentId,i.id)));
   const [row]=approval?await tx.select(saleReviewSelection).from(disposalReviews).where(and(eq(disposalReviews.intentId,i.id),eq(disposalReviews.accountId,a.id),eq(disposalReviews.revision,approval.reviewRevision))):[];
   if(!approval||!row||approval.ownerId!==ctx.ownerId)throw new ApprovalError("conflict");const review=projectStoredSaleReview(row),binding=normalizeDisposalBinding(r.binding),providerId=review.terms.review.quote.providerOrderId;
   matchBinding(binding,review.terms.review.binding);
   let evidence:SaleOrderEvidence|null=null,kind:typeof disposalOutcomes.$inferSelect["kind"]=input.kind==="response"?"invalid_response":input.kind as "unavailable"|"not_found";
   if(input.kind==="response")try{evidence=normalizeDisposalOrder(input.body,binding,providerId,review.terms.review.requestedBase);kind=evidence.providerStatus==="initialized"?"initialized":"observed";}catch{kind="invalid_response";}
   const hash=createHash("sha256").update(JSON.stringify(["harborline-sale-observation-v2",kind,evidence])).digest("hex"),[old]=await tx.select().from(disposalOutcomes).where(and(eq(disposalOutcomes.readId,r.id),eq(disposalOutcomes.accountId,a.id)));
   if(old){if(old.observationHash!==hash)throw new ApprovalError("conflict");return saleRecoveryView(tx,a,i);}
   const [latest]=await tx.select({id:disposalReads.id}).from(disposalReads).where(and(eq(disposalReads.accountId,a.id),eq(disposalReads.intentId,i.id),eq(disposalReads.purpose,"order"))).orderBy(desc(disposalReads.sequence)).limit(1);
   let matches=false;try{matchBinding(binding,store.binding(ctx,a,i));matches=i.providerOrderId===providerId;}catch{}
   let disposition:typeof disposalOutcomes.$inferSelect["disposition"]=matches&&a.activeOperationId===i.id&&r.intentRevision===i.revision&&r.generation===i.preparationGeneration&&latest?.id===r.id?"applied":"ignored";
   const terminal=await saleTerminal(tx,a,i),mapped=evidence&&kind==="observed"?({complete:"COMPLETE",failed:"FAILED",canceled:"CANCELED",pending:"PENDING",active:"PENDING",cancel_pending:"PENDING",initialized:"UNKNOWN"} as const)[evidence.providerStatus]:null;
   if(disposition==="applied"){
    if(kind==="invalid_response")disposition="conflict";
    if(kind==="initialized"&&(terminal||i.state==="PENDING"))disposition="ignored";
    if(terminal&&mapped&&mapped!==terminal)disposition=isTerminalState(mapped)?"conflict":"ignored";
    if(evidence&&kind==="observed"&&disposition==="applied"){
     const [bounds]=await tx.select({filled:sql<string|null>`max((${disposalOutcomes.evidence}->>'filledBase')::numeric)`,remaining:sql<string|null>`min((${disposalOutcomes.evidence}->>'remainingBase')::numeric)`,fee:sql<string|null>`max((${disposalOutcomes.evidence}->>'feeQuote')::numeric)`,gross:sql<string|null>`max((${disposalOutcomes.evidence}->>'grossQuote')::numeric)`}).from(disposalOutcomes).where(and(eq(disposalOutcomes.accountId,a.id),eq(disposalOutcomes.intentId,i.id),eq(disposalOutcomes.kind,"observed"),eq(disposalOutcomes.disposition,"applied")));
     const less=(v:string|null,p:string|null|undefined)=>v!==null&&p!=null&&compareAmounts(parseAmount(v),parseAmount(p))<0,more=(v:string|null,p:string|null|undefined)=>v!==null&&p!=null&&compareAmounts(parseAmount(v),parseAmount(p))>0;
     if(less(evidence.filledBase,bounds?.filled)||more(evidence.remainingBase,bounds?.remaining)||less(evidence.feeQuote,bounds?.fee)||less(evidence.grossQuote,bounds?.gross))disposition="conflict";
     const terminalReports=await tx.select({evidence:disposalOutcomes.evidence}).from(disposalOutcomes).where(and(eq(disposalOutcomes.accountId,a.id),eq(disposalOutcomes.intentId,i.id),eq(disposalOutcomes.kind,"observed"),eq(disposalOutcomes.disposition,"applied"),sql`${disposalOutcomes.evidence}->>'providerStatus' IN ('complete','failed','canceled')`));
     const fields=["filledBase","remainingBase","averagePriceQuote","feeQuote","grossQuote"] as const;
     if(terminalReports.some(p=>p.evidence&&fields.some(k=>p.evidence![k]!==null&&evidence![k]!==null&&p.evidence![k]!==evidence![k])))disposition="conflict";

    }
   }
   const now=store.clock();if(now<r.startedAt)throw new ApprovalError("unavailable");
   const inserted=await tx.insert(disposalOutcomes).values({readId:r.id,accountId:a.id,intentId:i.id,kind,disposition,evidence,observationHash:hash,observedAt:now,source:"contract_fixture"}).returning({id:disposalOutcomes.readId});if(inserted.length!==1)throw new ApprovalError("conflict");
   let next=i;if(disposition!=="ignored"){
    const state=i.state==="MANUAL_REVIEW"?i.state:disposition==="applied"&&mapped?mapped:i.state==="SUBMITTING"?"UNKNOWN":i.state;
    next=await changeSale(tx,i,now,state);await saleAudit(tx,ctx,i.id,"sale_order_observed",{readId:r.id,kind,disposition,providerStatus:evidence?.providerStatus??null},now);
   }
   return saleRecoveryView(tx,a,next);
  },true);
 },
 async current(ctx:OwnerContext,id:string):Promise<SaleRecoveryView>{return store.transaction(ctx,async(tx,a)=>saleRecoveryView(tx,a,await saleIntent(tx,a,id,false)),true);}
};}
