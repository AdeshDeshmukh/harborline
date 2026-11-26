import "server-only";
import {and,desc,eq} from "drizzle-orm";
import {disposalReviews} from "../../server/db/schema";
import type {OwnerContext} from "../identity/access.server";
import {changeSale,saleAudit,saleIntent,type DisposalStore} from "./disposal-store.server";
import {ApprovalError} from "./approval-types";
import {buildStoredSaleTerms,hashStoredSaleTerms} from "./disposal-terms.server";
import {buildDisposalReview} from "./disposal-review";
import {loadSaleWallet} from "./disposal-reads.server";
import {orderId,quantity} from "./disposal-validation";
import {validateUnsignedPayloads} from "../../integrations/truemarkets/preparation.server";
export {projectStoredSaleReview,saleReviewSelection,currentSaleReview} from "./disposal-review-record.server";
import {projectStoredSaleReview,saleReviewSelection,type StoredSaleReviewView} from "./disposal-review-record.server";
import {authorizedSalePreparation,createDisposalPreparationFence} from "./disposal-preparation.server";
export function createDisposalReviews(store:DisposalStore){const fence=createDisposalPreparationFence(store);return {
 authorizePreparation:fence.authorize,rejectPreparation:fence.reject,
 async record(ctx:OwnerContext,input:{readId:string;quote:unknown;payloads:unknown}):Promise<StoredSaleReviewView>{
  const value=structuredClone(input);
  return store.transaction(ctx,async(tx,a)=>{
   const {disposalReads}=await import("../../server/db/schema");
   const [ticket]=await tx.select().from(disposalReads).where(and(eq(disposalReads.id,value.readId),eq(disposalReads.accountId,a.id)));if(!ticket)throw new ApprovalError("not_found");
   const i=await saleIntent(tx,a,ticket.intentId);await authorizedSalePreparation(tx,a,i,ticket.id);
   const wallet=await loadSaleWallet(store,tx,ctx,a,{...i,revision:ticket.intentRevision},ticket.id,"prepare"),now=store.clock();
   if(i.state!=="PREPARING"||i.effectsPossible||!i.preparationLeaseUntil||i.preparationLeaseUntil<=now)throw new ApprovalError("conflict");
   const binding=store.binding(ctx,a,i),review=buildDisposalReview(binding,{assetId:i.assetId,baseQuantity:quantity(i.requestedQty,binding.baseDecimals)},wallet.evidence.holding,value.quote,now),payloads=validateUnsignedPayloads(value.payloads);
   if(payloads.length!==review.quote.payloadDigests.length||payloads.some((p,n)=>p.digest!==review.quote.payloadDigests[n]))throw new ApprovalError("conflict");
   const terms=buildStoredSaleTerms(review,ticket.id),termsHash=hashStoredSaleTerms(terms),sealed=store.vault.seal(terms.binding,termsHash,payloads);
   const rows=await tx.insert(disposalReviews).values({accountId:a.id,intentId:i.id,revision:i.preparationGeneration,holdingReadId:ticket.id,terms,termsHash,maximumBaseDebit:review.requestedBase,payloadsEncrypted:sealed.ciphertext,nonce:sealed.nonce,tag:sealed.tag,encryptionKeyVersion:sealed.keyVersion,createdAt:now,expiresAt:new Date(review.quote.expiresAt)}).returning(saleReviewSelection);
   if(rows.length!==1)throw new ApprovalError("conflict");
   await changeSale(tx,i,now,"REVIEW_READY",{providerOrderId:review.quote.providerOrderId,reviewExpiresAt:new Date(review.quote.expiresAt),effectsPossible:false});
   await saleAudit(tx,ctx,i.id,"sale_review_recorded",{generation:i.preparationGeneration,termsHash},now);return projectStoredSaleReview(rows[0]);
  });
 },
 async get(ctx:OwnerContext,intentId:string):Promise<StoredSaleReviewView|null>{return store.transaction(ctx,async(tx,a)=>{const i=await saleIntent(tx,a,intentId,false);const [r]=await tx.select(saleReviewSelection).from(disposalReviews).where(and(eq(disposalReviews.intentId,i.id),eq(disposalReviews.accountId,a.id))).orderBy(desc(disposalReviews.revision)).limit(1);return r?projectStoredSaleReview(r):null;},true);},
 async incident(ctx:OwnerContext,intentId:string,reference:string|null,expected:{revision:number;generation:number}){return store.transaction(ctx,async(tx,a)=>{
  const i=await saleIntent(tx,a,intentId,false),now=store.clock();
  if(a.activeOperationId!==i.id||i.state!=="PREPARING"||i.revision!==expected.revision||i.preparationGeneration!==expected.generation){await saleAudit(tx,ctx,i.id,"sale_preparation_incident_ignored",{generation:expected.generation,providerOrderId:reference},now);return false;}
  await changeSale(tx,i,now,"UNKNOWN",{effectsPossible:true});await saleAudit(tx,ctx,i.id,"sale_preparation_incident",{providerOrderId:reference===null?null:orderId(reference)},now);return true;
 },true);}
};}
