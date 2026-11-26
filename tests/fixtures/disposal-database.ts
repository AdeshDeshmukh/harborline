import {randomUUID,createHash} from "node:crypto";
import {bootstrapAccount} from "../../src/features/accounts/repository.server";
import type {OwnerContext} from "../../src/features/identity/access.server";
import {createPlanningRepository} from "../../src/features/planning/repository.server";
import {createPlanningService} from "../../src/features/planning/service.server";
import {createDisposalStore} from "../../src/features/orders/disposal-store.server";
import {createDisposalReads} from "../../src/features/orders/disposal-reads.server";
import {createDisposalReviews} from "../../src/features/orders/disposal-reviews.server";
import {createDisposalApprovals} from "../../src/features/orders/disposal-approvals.server";
import {createReviewVault} from "../../src/features/orders/review-vault.server";
import type {SaleReadTicket} from "../../src/features/orders/disposal-store-types";
import type {SupportedAssets} from "../../src/integrations/truemarkets/read-types";
import {SOLANA_USDC_MINT} from "../../src/integrations/truemarkets/read-types";
import {binding as fixtureBinding,quote as fixtureQuote} from "./disposal";
import {admin,db,clock,intents,advance} from "./order-database";
export {admin,db,clock,intents,advance};
export const assets:SupportedAssets={stock:{id:fixtureBinding.assetId,address:fixtureBinding.assetAddress,symbol:"SAMPLE",name:"Fictional stock",decimals:8,chain:"solana",venue:"defi",type:"spot",assetClass:"stock",stable:false,tradeable:true},cash:{id:fixtureBinding.cashId,address:SOLANA_USDC_MINT,symbol:"USDC",name:"USD Coin",decimals:6,chain:"solana",venue:"defi",type:"spot",assetClass:"crypto",stable:true,tradeable:false}};
export const vault=createReviewVault(Buffer.alloc(32,12),1);
export async function newSaleAccount(){
 const identity={id:randomUUID(),email:"sale@example.invalid"},owner={...await bootstrapAccount(identity,db),email:identity.email} as OwnerContext;
 await createPlanningService(createPlanningRepository(db)).savePolicy(owner,{expectedRevision:1,horizonDays:30,additionalBuffer:"5000",acknowledged:true});
 await admin.query("UPDATE harborline.gateway_accounts SET provider_user_id=$2,provisioning_state='READY',public_key=$3,wallet_addresses=$4 WHERE id=$1",[owner.accountId,randomUUID(),"02"+"b".repeat(64),JSON.stringify({solana:"11111111111111111111111111111111"})]);
 let enabled=true,operator:string|null=randomUUID();const allowedOperator=operator;
 const store=createDisposalStore(db,{clock,fixtureMode:true,enabled:()=>enabled,operator:()=>operator,allowedOperatorIds:[allowedOperator],assets,vault}),reads=createDisposalReads(store),reviews=createDisposalReviews(store),approvals=createDisposalApprovals(store);
 const request={requestKey:randomUUID(),operationKind:"sell",assetId:assets.stock.id,requestedQty:"0.5",qtyUnit:"base",calculationId:null,expectedPolicyRevision:2};
 return {owner,request,store,reads,reviews,approvals,disable:()=>{enabled=false;},revoke:()=>{operator=null;}};
}
export function wallet(ticket:SaleReadTicket,available="1",cashAvailable="0"){
 const common={source:"contract_fixture" as const,binding:ticket.binding,chain:"solana" as const,venue:"defi" as const,held:"0",observedAt:ticket.startedAt};
 return {source:"contract_fixture",holding:{...common,assetId:assets.stock.id,address:assets.stock.address,decimals:8,available,total:available},cash:{...common,assetId:assets.cash.id,address:SOLANA_USDC_MINT,decimals:6,available:cashAvailable,total:cashAvailable}};
}
export function prepared(ticket:SaleReadTicket,orderId=randomUUID()){
 const payload="fictional sale\n",digest=createHash("sha256").update(payload).digest("hex");
 return {quote:{...fixtureQuote,binding:ticket.binding,providerOrderId:orderId,observedAt:clock().toISOString(),expiresAt:new Date(clock().getTime()+20000).toISOString(),payloadDigests:[digest]},payloads:[{payload,digest}]};
}
export async function reviewedSale(){const d=await setupSale(),ticket=await d.reads.begin(d.owner,d.intentId,"prepare");await d.reads.record(d.owner,ticket.id,wallet(ticket));await d.reviews.authorizePreparation(d.owner,ticket.id);const p=prepared(ticket),review=await d.reviews.record(d.owner,{readId:ticket.id,...p});return {...d,review,command:{intentId:d.intentId,reviewRevision:review.revision,termsHash:review.termsHash,acknowledged:true as const}};}
export async function approvalRead(d:Awaited<ReturnType<typeof reviewedSale>>){const t=await d.reads.begin(d.owner,d.intentId,"approval");await d.reads.record(d.owner,t.id,wallet(t));return t;}

export async function setupSale(){const d=await newSaleAccount(),claim=await intents.claim(d.owner,d.request),preparing=await intents.beginPreparation(d.owner,claim.intent.id,claim.intent.revision);return {...d,intentId:preparing.id};}
