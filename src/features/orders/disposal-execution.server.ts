import "server-only";
import {and,eq,sql} from "drizzle-orm";
import {auditEvents,disposalDispatches,disposalReviews,disposalSendAuthorizations} from "../../server/db/schema";
import type {OwnerContext} from "../identity/access.server";
import {changeSale,saleAudit,saleIntent,type DisposalStore,type SaleAccount,type SaleIntent,type SaleTx} from "./disposal-store.server";
import type {ExecutionPort,ExecutionWork,ExecutionStatus} from "./execution-types";
import type {SaleReadTicket} from "./disposal-store-types";
import {loadSaleWallet,type createDisposalReads} from "./disposal-reads.server";
import {currentSaleReview} from "./disposal-reviews.server";
import {findSaleApproval} from "./disposal-approvals.server";
import {normalizeApprovalCommand} from "./approval-command";
import {ApprovalError} from "./approval-types";
import {revalidateDisposalReview} from "./disposal-review";
import {uuid} from "./disposal-validation";
import {isTerminalState} from "./outcome-history.server";
import {saleTerminal} from "./disposal-outcome-history.server";
export function createDisposalExecutionRepository(store:DisposalStore){
 const command=normalizeApprovalCommand;
 async function approved(tx:SaleTx,ctx:OwnerContext,a:SaleAccount,i:SaleIntent,c:ReturnType<typeof command>){const approval=await findSaleApproval(tx,ctx,a,i,c);if(!approval)throw new ApprovalError("conflict");return approval;}
 return {
  async claim(ctx:OwnerContext,value:unknown):Promise<ExecutionWork|null>{const c=command(value);return store.transaction(ctx,async(tx,a)=>{
   const i=await saleIntent(tx,a,c.intentId,false),approval=await approved(tx,ctx,a,i,c),[old]=await tx.select().from(disposalDispatches).where(and(eq(disposalDispatches.attemptId,approval.attemptId),eq(disposalDispatches.accountId,a.id)));if(old)return null;
   if(a.activeOperationId!==i.id||i.state!=="SUBMITTING"||!i.effectsPossible||!a.publicKey)throw new ApprovalError("conflict");
   const {view}=await currentSaleReview(store,tx,ctx,a,i),[sealed]=await tx.select({ciphertext:disposalReviews.payloadsEncrypted,nonce:disposalReviews.nonce,tag:disposalReviews.tag,keyVersion:disposalReviews.encryptionKeyVersion}).from(disposalReviews).where(and(eq(disposalReviews.intentId,i.id),eq(disposalReviews.accountId,a.id),eq(disposalReviews.revision,c.reviewRevision)));
   const now=store.clock();if(!sealed||Date.parse(view.expiresAt)<=now.getTime()||approval.approvedAt>now)throw new ApprovalError("stale_inputs");store.enabled();
   const rows=await tx.insert(disposalDispatches).values({attemptId:approval.attemptId,intentId:i.id,accountId:a.id,source:"contract_fixture",claimedAt:now}).returning({id:disposalDispatches.attemptId});if(rows.length!==1)throw new ApprovalError("conflict");
   await saleAudit(tx,ctx,i.id,"sale_dispatch_claimed",{attemptId:approval.attemptId},now);
   return {attemptId:approval.attemptId,intentId:i.id,termsHash:c.termsHash,providerOrderId:view.terms.review.quote.providerOrderId,providerUserId:view.terms.binding.providerUserId,publicKey:a.publicKey,binding:view.terms.binding,payloadHashes:view.terms.review.quote.payloadDigests,sealed};
  });},
  async checkSend(ctx:OwnerContext,value:unknown,attemptId:string,readId:string,authorize:boolean):Promise<Awaited<ReturnType<ExecutionPort["authorizeSend"]>>>{const c=command(value);return store.transaction(ctx,async(tx,a)=>{
   const i=await saleIntent(tx,a,c.intentId),approval=await approved(tx,ctx,a,i,c),[dispatch]=await tx.select().from(disposalDispatches).where(and(eq(disposalDispatches.attemptId,uuid(attemptId)),eq(disposalDispatches.intentId,i.id),eq(disposalDispatches.accountId,a.id)));
   if(!dispatch||approval.attemptId!==attemptId||i.state!=="SUBMITTING"||!i.effectsPossible||!a.publicKey)throw new ApprovalError("conflict");
   const {view}=await currentSaleReview(store,tx,ctx,a,i),wallet=await loadSaleWallet(store,tx,ctx,a,i,readId,"send"),now=store.clock();
   if(wallet.read.approvalId!==approval.id||wallet.read.startedAt<approval.approvedAt||wallet.read.startedAt<dispatch.claimedAt)throw new ApprovalError("stale_inputs");
   revalidateDisposalReview(view.terms.review,store.binding(ctx,a,i),wallet.evidence.holding,now);store.enabled();
   if(authorize){const rows=await tx.insert(disposalSendAuthorizations).values({attemptId:approval.attemptId,intentId:i.id,accountId:a.id,readId:wallet.read.id,authorizedAt:now,source:"contract_fixture"}).onConflictDoNothing().returning({id:disposalSendAuthorizations.attemptId});if(rows.length!==1)throw new ApprovalError("conflict");await saleAudit(tx,ctx,i.id,"sale_send_authorized",{attemptId,readId:wallet.read.id},now);}
   const deadline=Date.parse(view.expiresAt),observed=wallet.read.startedAt.getTime(),approvedAt=approval.approvedAt.getTime();
   const assertFresh=()=>{store.enabled();const at=store.clock().getTime();if(at>=deadline||at<approvedAt||at-observed<0||at-observed>15000)throw new ApprovalError("stale_inputs");};
   return {providerOrderId:view.terms.review.quote.providerOrderId,providerUserId:view.terms.binding.providerUserId,publicKey:a.publicKey,assertFresh};
  });},
  async finish(ctx:OwnerContext,value:unknown,attemptId:string,status:ExecutionStatus):Promise<void>{const c=command(value);if(status!==null&&!["complete","pending","failed","canceled"].includes(status))throw new ApprovalError("invalid_request");return store.transaction(ctx,async(tx,a)=>{
   const i=await saleIntent(tx,a,c.intentId),approval=await approved(tx,ctx,a,i,c),[dispatch]=await tx.select().from(disposalDispatches).where(and(eq(disposalDispatches.attemptId,uuid(attemptId)),eq(disposalDispatches.intentId,i.id),eq(disposalDispatches.accountId,a.id)));
   if(!dispatch||approval.attemptId!==attemptId||!i.effectsPossible||!["SUBMITTING","PENDING","UNKNOWN","MANUAL_REVIEW","COMPLETE","FAILED","CANCELED"].includes(i.state))throw new ApprovalError("conflict");
   const [same]=await tx.select({id:auditEvents.id}).from(auditEvents).where(and(eq(auditEvents.accountId,a.id),eq(auditEvents.intentId,i.id),eq(auditEvents.eventType,"execution_observed"),sql`${auditEvents.metadata}->>'attemptId'=${attemptId} AND ${auditEvents.metadata}->>'providerStatus' IS NOT DISTINCT FROM ${status}`)).limit(1);if(same)return;
   const mapped=status===null?null:({complete:"COMPLETE",pending:"PENDING",failed:"FAILED",canceled:"CANCELED"} as const)[status],terminal=await saleTerminal(tx,a,i),now=store.clock(),disposition=terminal&&mapped!==terminal?mapped&&isTerminalState(mapped)?"conflict":"ignored":"applied";
   const state=i.state==="MANUAL_REVIEW"?i.state:disposition==="applied"&&mapped?mapped:status===null&&i.state==="SUBMITTING"?"UNKNOWN":i.state;
   if(disposition!=="ignored")await changeSale(tx,i,now,state);
   await saleAudit(tx,ctx,i.id,"execution_observed",{attemptId,providerStatus:status,disposition,operationKind:"sell",source:"contract_fixture"},now);
  },true);},
  async current(ctx:OwnerContext,value:unknown):Promise<string>{const c=command(value);return store.transaction(ctx,async(tx,a)=>{const i=await saleIntent(tx,a,c.intentId,false);await approved(tx,ctx,a,i,c);return i.state;},true);}
 };
}
export function createDisposalExecutionPort(repository:ReturnType<typeof createDisposalExecutionRepository>,reads:ReturnType<typeof createDisposalReads>,refresh:(ctx:OwnerContext,ticket:SaleReadTicket)=>Promise<unknown>):ExecutionPort {
 async function wallet(ctx:OwnerContext,intentId:string){const ticket=await reads.begin(ctx,intentId,"send"),result=await reads.record(ctx,ticket.id,await refresh(ctx,ticket));if(!result.accepted)throw new ApprovalError("conflict");return ticket.id;}
 return {
  async claim(ctx,value){const work=await repository.claim(ctx,value);if(!work)return null;try{await repository.checkSend(ctx,value,work.attemptId,await wallet(ctx,work.intentId),false);return work;}catch(e){await repository.finish(ctx,value,work.attemptId,null);throw e;}},
  async authorizeSend(ctx,value,attemptId){const c=normalizeApprovalCommand(value);return repository.checkSend(ctx,c,attemptId,await wallet(ctx,c.intentId),true);},
  finish:repository.finish,current:repository.current,
 };
}
