import "server-only";
import type {OwnerContext} from "../identity/access.server";
import type {DisposalStore} from "./disposal-store.server";
import type {SaleReadTicket} from "./disposal-store-types";
import type {createIntentRepository} from "./repository.server";
import type {createDisposalReads} from "./disposal-reads.server";
import type {createDisposalReviews} from "./disposal-reviews.server";
import {normalizeIntentRequest} from "./request.server";
import {ApprovalError} from "./approval-types";
import {record,orderId} from "./disposal-validation";
export type DisposalPreparationDependencies={source:"contract_fixture"|"provider";store:DisposalStore;intents:ReturnType<typeof createIntentRepository>;reads:ReturnType<typeof createDisposalReads>;reviews:ReturnType<typeof createDisposalReviews>;wallet:(ctx:OwnerContext,ticket:SaleReadTicket)=>Promise<unknown>;prepare:(ctx:OwnerContext,ticket:SaleReadTicket)=>Promise<unknown>};
/** Explicitly injected fixture callbacks only. No runtime provider composition. */
export function createDisposalPreparationService(deps:DisposalPreparationDependencies){
 async function result(ctx:OwnerContext,id:string){const intent=await deps.intents.get(ctx,id);return {intentId:id,state:intent.state,review:await deps.reviews.get(ctx,id),canApprove:false as const,canExecute:false as const};}
 return {async prepare(ctx:OwnerContext,value:unknown){
  if(deps.source!=="contract_fixture")throw new ApprovalError("disabled");deps.store.enabled();
  const {command}=normalizeIntentRequest(value);if(command.operationKind!=="sell"||command.calculationId!==null||command.assetId!==deps.store.assets.stock.id)throw new ApprovalError("invalid_request");
  const claimed=await deps.intents.claim(ctx,command);if(claimed.replayed)return result(ctx,claimed.intent.id);
  const preparing=await deps.intents.beginPreparation(ctx,claimed.intent.id,claimed.intent.revision);let attempted=false,reference:string|null=null,expected={revision:preparing.revision+1,generation:preparing.preparationGeneration};
  try{
   const ticket=await deps.reads.begin(ctx,preparing.id,"prepare"),wallet=await deps.reads.record(ctx,ticket.id,await deps.wallet(ctx,ticket));if(!wallet.accepted)throw new ApprovalError("conflict");deps.store.enabled();
   const fence=await deps.reviews.authorizePreparation(ctx,ticket.id);expected={revision:fence.revision,generation:fence.generation};attempted=true;fence.assertFresh();
   const response=await deps.prepare(ctx,ticket);
   if(!response||typeof response!=="object"||Array.isArray(response))throw new ApprovalError("unavailable");const r=response as Record<string,unknown>;
   if(r.kind==="rejected"){record(r,["kind"]);await deps.reviews.rejectPreparation(ctx,ticket.id);return result(ctx,preparing.id);}
   record(r,["kind","quote","payloads"]);if(r.kind!=="prepared")throw new ApprovalError("unavailable");
   try{reference=orderId((r.quote as Record<string,unknown>)?.providerOrderId);}catch{}
   await deps.reviews.record(ctx,{readId:ticket.id,quote:r.quote,payloads:r.payloads});
  }catch(e){
   if(attempted||(await deps.intents.get(ctx,preparing.id)).revision===expected.revision){await deps.reviews.incident(ctx,preparing.id,reference,expected);return result(ctx,preparing.id);}
   await deps.intents.abandon(ctx,preparing.id,preparing.revision);throw e instanceof ApprovalError?e:new ApprovalError("unavailable");
  }
  return result(ctx,preparing.id);
 }};
}
