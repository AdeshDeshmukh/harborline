import "server-only";
import {and,eq,sql} from "drizzle-orm";
import {DatabaseError,type getDatabase} from "../../server/db";
import {auditEvents,gatewayAccounts,investmentIntents} from "../../server/db/schema";
import type {OwnerContext} from "../identity/access.server";
import type {SupportedAssets} from "../../integrations/truemarkets/read-types";
import {normalizeAssets} from "../../integrations/truemarkets/read-contracts";
import {ApprovalError} from "./approval-types";
import {DisposalError,type DisposalBinding} from "./disposal-types";
import {ReviewError} from "./review-types";
import {IntentStoreError,type IntentState} from "./types";
import {normalizeDisposalBinding,time,uuid} from "./disposal-validation";
import type {createReviewVault} from "./review-vault.server";
export type SaleTx=Parameters<Parameters<ReturnType<typeof getDatabase>["withOwner"]>[1]>[0];
export type SaleAccount=typeof gatewayAccounts.$inferSelect;
export type SaleIntent=typeof investmentIntents.$inferSelect;
export type DisposalStore=ReturnType<typeof createDisposalStore>;
export function createDisposalStore(database:ReturnType<typeof getDatabase>,options:{clock:()=>Date;fixtureMode?:boolean;enabled:()=>boolean;operator:()=>string|null;allowedOperatorIds:readonly string[];assets:SupportedAssets;vault:ReturnType<typeof createReviewVault>}) {
  const permitted=new Set(options.allowedOperatorIds.map(uuid));
  const raw=(a:SupportedAssets["stock"])=>({id:a.id,address:a.address,symbol:a.symbol,name:a.name,decimals:a.decimals,chain:a.chain,venue:a.venue,type:a.type,asset_class:a.assetClass,stable:a.stable,tradeable:a.tradeable,status:"active",order_types:["market"],networks:[{network:"solana",compatible_networks:["solana"]}]});
  const assets=normalizeAssets({data:[raw(structuredClone(options.assets.stock)),raw(structuredClone(options.assets.cash))]},{stockId:options.assets.stock.id,stockAddress:options.assets.stock.address,cashId:options.assets.cash.id});
  function readEnabled(){if(options.fixtureMode!==true)throw new ApprovalError("disabled");const operator=options.operator();if(!operator||!permitted.has(uuid(operator)))throw new ApprovalError("disabled");return uuid(operator);}
  function enabled(){const operator=readEnabled();if(options.enabled()!==true)throw new ApprovalError("disabled");return operator;}
  function clock(){const now=options.clock();time(now);return new Date(now);}
  async function transaction<T>(ctx:OwnerContext,work:(tx:SaleTx,a:SaleAccount)=>Promise<T>,completion=false):Promise<T>{
    const guard=()=>{if(completion){if(options.fixtureMode!==true)throw new ApprovalError("disabled");}else enabled();};
    guard();let domain:Error|undefined;
    try{return await database.withOwner(ctx.ownerId,async tx=>{try{
      await tx.execute(sql`SET LOCAL lock_timeout='3s'`);await tx.execute(sql`SET LOCAL statement_timeout='5s'`);
      const [a]=await tx.select().from(gatewayAccounts).where(and(eq(gatewayAccounts.id,ctx.accountId),eq(gatewayAccounts.ownerId,ctx.ownerId))).for("update");guard();
      if(!a||a.externalRefId!==ctx.externalRefId)throw new ApprovalError("not_found");
      return await work(tx,a);
    }catch(e){if(e instanceof ApprovalError||e instanceof DisposalError||e instanceof ReviewError||e instanceof IntentStoreError){domain=e;throw new DatabaseError("operation_failed");}throw e;}});}catch{throw domain??new ApprovalError("unavailable");}
  }
  function binding(ctx:OwnerContext,a:SaleAccount,i:SaleIntent):DisposalBinding {
    if(a.provisioningState!=="READY"||!a.providerUserId||i.assetId!==assets.stock.id||i.policyRevision!==a.policyRevision)throw new ApprovalError("conflict");
    return normalizeDisposalBinding({ownerId:ctx.ownerId,accountId:a.id,providerUserId:a.providerUserId,intentId:i.id,generation:i.preparationGeneration,policyRevision:i.policyRevision,assetId:assets.stock.id,assetAddress:assets.stock.address,cashId:assets.cash.id,baseDecimals:assets.stock.decimals});
  }
  return {transaction,enabled,readEnabled,clock,binding,assets,vault:options.vault};
}
export async function saleIntent(tx:SaleTx,a:SaleAccount,value:string,active=true):Promise<SaleIntent>{
  const [i]=await tx.select().from(investmentIntents).where(and(eq(investmentIntents.id,uuid(value)),eq(investmentIntents.accountId,a.id)));
  if(!i)throw new ApprovalError("not_found");
  if(i.operationKind!=="sell"||i.qtyUnit!=="base"||i.calculationId!==null||i.preparationSafety!=="contract_fixture"||active&&a.activeOperationId!==i.id)throw new ApprovalError("conflict");return i;
}
export async function changeSale(tx:SaleTx,i:SaleIntent,now:Date,state:IntentState,changes:Partial<Pick<SaleIntent,"providerOrderId"|"reviewExpiresAt"|"effectsPossible">>={}) {
  if(i.revision>=2147483647)throw new ApprovalError("conflict");
  const rows=await tx.update(investmentIntents).set({...changes,state,revision:i.revision+1,updatedAt:now}).where(and(eq(investmentIntents.id,i.id),eq(investmentIntents.accountId,i.accountId),eq(investmentIntents.revision,i.revision),eq(investmentIntents.state,i.state),eq(investmentIntents.preparationGeneration,i.preparationGeneration))).returning();
  if(rows.length!==1)throw new ApprovalError("conflict");return rows[0];
}
export async function saleAudit(tx:SaleTx,ctx:OwnerContext,id:string,eventType:string,metadata:Record<string,string|number|boolean|null>,at:Date){
  const rows=await tx.insert(auditEvents).values({accountId:ctx.accountId,intentId:id,actorId:ctx.ownerId,eventType,metadata,occurredAt:at}).returning({id:auditEvents.id});if(rows.length!==1)throw new ApprovalError("conflict");
}
