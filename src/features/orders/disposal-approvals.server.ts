import "server-only";
import {and,eq} from "drizzle-orm";
import {balanceSnapshots,disposalApprovals} from "../../server/db/schema";
import type {OwnerContext} from "../identity/access.server";
import {changeSale,saleAudit,saleIntent,type DisposalStore,type SaleTx,type SaleAccount,type SaleIntent} from "./disposal-store.server";
import {ApprovalError,type ApprovalReceipt} from "./approval-types";
import {normalizeApprovalCommand} from "./approval-command";
import {currentSaleReview} from "./disposal-reviews.server";
import {loadSaleWallet} from "./disposal-reads.server";
import {revalidateDisposalReview} from "./disposal-review";
import {record,uuid} from "./disposal-validation";
export function saleApprovalReceipt(r:typeof disposalApprovals.$inferSelect,i:SaleIntent,accepted:boolean):ApprovalReceipt{return {intentId:i.id,approvalId:r.id,attemptId:r.attemptId,reviewRevision:r.reviewRevision,termsHash:r.termsHash,approvedAt:r.approvedAt.toISOString(),state:i.state,source:"contract_fixture",accepted,canExecute:false};}
export async function findSaleApproval(tx:SaleTx,ctx:OwnerContext,a:SaleAccount,i:SaleIntent,c:ReturnType<typeof normalizeApprovalCommand>){
 const [r]=await tx.select().from(disposalApprovals).where(and(eq(disposalApprovals.accountId,a.id),eq(disposalApprovals.intentId,i.id)));
 if(r&&(r.ownerId!==ctx.ownerId||r.reviewRevision!==c.reviewRevision||r.termsHash!==c.termsHash||r.source!=="contract_fixture"))throw new ApprovalError("conflict");return r??null;
}
export function createDisposalApprovals(store:DisposalStore){return {
 async get(ctx:OwnerContext,value:unknown):Promise<ApprovalReceipt|null>{const c=normalizeApprovalCommand(value);return store.transaction(ctx,async(tx,a)=>{const i=await saleIntent(tx,a,c.intentId,false),r=await findSaleApproval(tx,ctx,a,i,c);return r?saleApprovalReceipt(r,i,false):null;});},
 async approve(ctx:OwnerContext,value:unknown,observation:unknown):Promise<ApprovalReceipt>{
  const c=normalizeApprovalCommand(value),input=record(structuredClone(observation),["readId"]),readId=uuid(input.readId);
  return store.transaction(ctx,async(tx,a)=>{
   const i=await saleIntent(tx,a,c.intentId,false),old=await findSaleApproval(tx,ctx,a,i,c);if(old)return saleApprovalReceipt(old,i,false);
   if(a.activeOperationId!==i.id||i.state!=="REVIEW_READY"||i.effectsPossible)throw new ApprovalError("conflict");
   const review=await currentSaleReview(store,tx,ctx,a,i);if(review.view.termsHash!==c.termsHash||review.view.revision!==c.reviewRevision)throw new ApprovalError("conflict");
   const wallet=await loadSaleWallet(store,tx,ctx,a,i,readId,"approval"),now=store.clock();store.enabled();
   revalidateDisposalReview(review.view.terms.review,store.binding(ctx,a,i),wallet.evidence.holding,now);
   if(wallet.read.startedAt<review.row.createdAt||wallet.evidence.cash.held!=="0")throw new ApprovalError("stale_inputs");
   const [cash]=await tx.insert(balanceSnapshots).values({accountId:a.id,listingId:store.assets.cash.id,chain:"solana",venue:"defi",source:"fixture",available:wallet.evidence.cash.available,observedAt:wallet.read.startedAt}).returning({id:balanceSnapshots.id});if(!cash)throw new ApprovalError("conflict");
   const rows=await tx.insert(disposalApprovals).values({accountId:a.id,intentId:i.id,ownerId:ctx.ownerId,operatorId:store.enabled(),reviewRevision:c.reviewRevision,termsHash:c.termsHash,holdingReadId:readId,cashBaselineId:cash.id,approvedAt:now,source:"contract_fixture"}).returning();if(rows.length!==1)throw new ApprovalError("conflict");
   const changed=await changeSale(tx,i,now,"SUBMITTING",{effectsPossible:true});await saleAudit(tx,ctx,i.id,"sale_approved",{reviewRevision:c.reviewRevision,attemptId:rows[0].attemptId},now);return saleApprovalReceipt(rows[0],changed,true);
  });
 },
 async markFixtureUnknown(ctx:OwnerContext,value:unknown,attemptId:string):Promise<ApprovalReceipt>{const c=normalizeApprovalCommand(value);return store.transaction(ctx,async(tx,a)=>{
  const i=await saleIntent(tx,a,c.intentId),r=await findSaleApproval(tx,ctx,a,i,c);if(!r||r.attemptId!==uuid(attemptId))throw new ApprovalError("conflict");const now=store.clock();
  const result=i.state==="SUBMITTING"?await changeSale(tx,i,now,"UNKNOWN",{effectsPossible:true}):i;await saleAudit(tx,ctx,i.id,"sale_execution_uncertain",{attemptId:r.attemptId},now);return saleApprovalReceipt(r,result,false);
 },true);}
};}
