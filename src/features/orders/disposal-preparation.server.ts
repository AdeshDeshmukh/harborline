import "server-only";
import {and,eq,sql} from "drizzle-orm";
import {auditEvents,disposalReads,gatewayAccounts} from "../../server/db/schema";
import type {OwnerContext} from "../identity/access.server";
import {compareAmounts,parseAmount} from "../planning/money";
import {ApprovalError} from "./approval-types";
import {saleIntent,changeSale,saleAudit,type DisposalStore,type SaleTx,type SaleAccount,type SaleIntent} from "./disposal-store.server";
import {loadSaleWallet} from "./disposal-reads.server";
import {tokenQuantity,uuid} from "./disposal-validation";
import {hasSalePreparationAttempt} from "./sale-preparation-history.server";
/** An append-only authorization protects pending preparation without resetting the monotonic effects flag. */
export async function authorizedSalePreparation(tx:SaleTx,a:SaleAccount,i:SaleIntent,readId:string){
 const [read]=await tx.select().from(disposalReads).where(and(eq(disposalReads.id,uuid(readId)),eq(disposalReads.accountId,a.id),eq(disposalReads.intentId,i.id),eq(disposalReads.purpose,"prepare")));
 const [mark]=await tx.select({id:auditEvents.id}).from(auditEvents).where(and(eq(auditEvents.accountId,a.id),eq(auditEvents.intentId,i.id),eq(auditEvents.eventType,"sale_preparation_authorized"),sql`${auditEvents.metadata}->>'readId'=${readId} AND (${auditEvents.metadata}->>'revision')::integer=${i.revision} AND (${auditEvents.metadata}->>'generation')::integer=${i.preparationGeneration}`));
 if(!read||!mark||i.effectsPossible||i.state!=="PREPARING"||a.activeOperationId!==i.id||read.generation!==i.preparationGeneration||read.intentRevision+1!==i.revision)throw new ApprovalError("conflict");return read;
}
export function createDisposalPreparationFence(store:DisposalStore){return {
 async authorize(ctx:OwnerContext,readId:string){return store.transaction(ctx,async(tx,a)=>{
  const [read]=await tx.select().from(disposalReads).where(and(eq(disposalReads.id,uuid(readId)),eq(disposalReads.accountId,a.id)));if(!read)throw new ApprovalError("not_found");
  const i=await saleIntent(tx,a,read.intentId),wallet=await loadSaleWallet(store,tx,ctx,a,i,read.id,"prepare"),now=store.clock();
  if(await hasSalePreparationAttempt(tx,a.id,i.id,i.preparationGeneration))throw new ApprovalError("conflict");
  if(i.state!=="PREPARING"||i.effectsPossible||!i.preparationLeaseUntil||i.preparationLeaseUntil<=now)throw new ApprovalError("conflict");
  const requested=tokenQuantity(i.requestedQty,read.binding.baseDecimals,true);
  if(compareAmounts(parseAmount(requested),parseAmount(wallet.evidence.holding.available))>0)throw new ApprovalError("invalid_request");
  const changed=await changeSale(tx,i,now,"PREPARING");await saleAudit(tx,ctx,i.id,"sale_preparation_authorized",{readId:read.id,revision:changed.revision,generation:changed.preparationGeneration},now);
  const lease=i.preparationLeaseUntil.getTime(),observed=read.startedAt.getTime();
  return {revision:changed.revision,generation:changed.preparationGeneration,assertFresh(){store.enabled();const at=store.clock().getTime();if(at>=lease||at<observed||at-observed>15000)throw new ApprovalError("stale_inputs");}};
 });},
 async reject(ctx:OwnerContext,readId:string){return store.transaction(ctx,async(tx,a)=>{
  const [read]=await tx.select().from(disposalReads).where(and(eq(disposalReads.id,uuid(readId)),eq(disposalReads.accountId,a.id)));if(!read)throw new ApprovalError("not_found");
  const i=await saleIntent(tx,a,read.intentId);await authorizedSalePreparation(tx,a,i,read.id);const now=store.clock();
  await changeSale(tx,i,now,"REJECTED",{effectsPossible:false});const released=await tx.update(gatewayAccounts).set({activeOperationId:null}).where(and(eq(gatewayAccounts.id,a.id),eq(gatewayAccounts.activeOperationId,i.id))).returning({id:gatewayAccounts.id});if(released.length!==1)throw new ApprovalError("conflict");
  await saleAudit(tx,ctx,i.id,"sale_preparation_rejected",{readId:read.id,generation:i.preparationGeneration},now);
 },true);}
};}
