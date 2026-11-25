import "server-only";
import {and,asc,eq,isNull,sql} from "drizzle-orm";
import {DatabaseError,getDatabase} from "../../server/db";
import {auditEvents,calculationSnapshots,gatewayAccounts,investmentIntents} from "../../server/db/schema";
import {isUuid} from "../../server/env";
import {parseAmount} from "../planning/money";
import type {OwnerContext} from "../identity/access.server";
import {normalizeIntentRequest} from "./request.server";
import {canAdvance,cleanupDecision} from "./lifecycle";
import {IntentStoreError,type IntentState,type IntentView} from "./types";
type Tx=Parameters<Parameters<ReturnType<typeof getDatabase>["withOwner"]>[1]>[0];
type Row=typeof investmentIntents.$inferSelect;
type Account=typeof gatewayAccounts.$inferSelect;
type Changes=Partial<Pick<Row,"state"|"preparationGeneration"|"preparationLeaseUntil"|"reviewExpiresAt"|"providerOrderId"|"effectsPossible">>;
function id(value:string){if(!isUuid(value))throw new IntentStoreError("invalid_request");return value.toLowerCase();}
function revision(value:number){if(!Number.isInteger(value)||value<1||value>2147483647)throw new IntentStoreError("invalid_request");return value;}
function view(row:Row):IntentView{return Object.freeze({id:row.id,operationKind:row.operationKind,assetId:row.assetId,requestedQty:parseAmount(row.requestedQty),qtyUnit:row.qtyUnit,calculationId:row.calculationId,policyRevision:row.policyRevision,state:row.state,revision:row.revision,preparationGeneration:row.preparationGeneration,preparationLeaseUntil:row.preparationLeaseUntil?.toISOString()??null,reviewExpiresAt:row.reviewExpiresAt?.toISOString()??null,providerOrderId:row.providerOrderId,preparationSafety:row.preparationSafety,effectsPossible:row.effectsPossible,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),canExecute:false});}
async function account(tx:Tx,context:OwnerContext,writing:boolean){
 await tx.execute(sql`SET LOCAL lock_timeout='3s'`);await tx.execute(sql`SET LOCAL statement_timeout='5s'`);
 const [row]=await tx.select().from(gatewayAccounts).where(and(eq(gatewayAccounts.id,context.accountId),eq(gatewayAccounts.ownerId,context.ownerId))).for(writing?"update":"share");
 if(!row||row.externalRefId!==context.externalRefId)throw new IntentStoreError("not_found");return row;
}
async function intent(tx:Tx,accountId:string,intentId:string){const [row]=await tx.select().from(investmentIntents).where(and(eq(investmentIntents.id,intentId),eq(investmentIntents.accountId,accountId)));if(!row)throw new IntentStoreError("not_found");return row;}
async function audit(tx:Tx,context:OwnerContext,row:Row,eventType:string,metadata:Record<string,string|number|boolean|null>,timestamp:Date){await tx.insert(auditEvents).values({accountId:context.accountId,intentId:row.id,actorId:context.ownerId,eventType,metadata,occurredAt:timestamp});}
async function save(tx:Tx,row:Row,changes:Changes,timestamp:Date){
 if(row.revision>=2147483647)throw new IntentStoreError("conflict");
 const [updated]=await tx.update(investmentIntents).set({...changes,revision:row.revision+1,updatedAt:timestamp}).where(and(eq(investmentIntents.id,row.id),eq(investmentIntents.accountId,row.accountId),eq(investmentIntents.revision,row.revision),eq(investmentIntents.state,row.state),eq(investmentIntents.preparationGeneration,row.preparationGeneration))).returning();
 if(!updated)throw new IntentStoreError("conflict");return updated;
}
async function release(tx:Tx,owned:Account,row:Row){
 const rows=await tx.update(gatewayAccounts).set({activeOperationId:null}).where(and(eq(gatewayAccounts.id,owned.id),eq(gatewayAccounts.activeOperationId,row.id))).returning({id:gatewayAccounts.id});
 if(rows.length!==1)throw new IntentStoreError("conflict");
}
function current(owned:Account,row:Row,expected:number){if(row.revision!==expected)throw new IntentStoreError("conflict");if(owned.activeOperationId!==row.id)throw new IntentStoreError("invalid_transition");}
export function createIntentRepository(database=getDatabase(),options:{fixtureMode?:boolean;clock?:()=>Date}={}){
 const fixtureMode=options.fixtureMode===true,clock=options.clock??(()=>new Date());
 function now(){const value=clock();if(!(value instanceof Date)||!Number.isFinite(value.getTime()))throw new IntentStoreError("invalid_request");return new Date(value);}
 async function transaction<T>(context:OwnerContext,work:(tx:Tx)=>Promise<T>):Promise<T>{
  let domain:IntentStoreError|undefined;
  try{return await database.withOwner(context.ownerId,async tx=>{try{return await work(tx);}catch(error){if(error instanceof IntentStoreError){domain=error;throw new DatabaseError("operation_failed");}throw error;}});}
  catch{if(domain)throw domain;throw new IntentStoreError("unavailable");}
 }
 async function change(context:OwnerContext,intentId:string,expected:number,work:(tx:Tx,owned:Account,row:Row,timestamp:Date)=>Promise<IntentView>){
  const key=id(intentId),expectedRevision=revision(expected);
  return transaction(context,async tx=>{const owned=await account(tx,context,true),row=await intent(tx,owned.id,key);if(row.revision!==expectedRevision)throw new IntentStoreError("conflict");return work(tx,owned,row,now());});
 }
 return {
  async claim(context:OwnerContext,value:unknown):Promise<{intent:IntentView;replayed:boolean}>{
   const {command,hash}=normalizeIntentRequest(value);
   return transaction(context,async tx=>{
    const owned=await account(tx,context,true);
    const [existing]=await tx.select().from(investmentIntents).where(and(eq(investmentIntents.accountId,owned.id),eq(investmentIntents.requestKey,command.requestKey)));
    if(existing){if(existing.requestHash!==hash)throw new IntentStoreError("request_conflict");return {intent:view(existing),replayed:true};}
    if(owned.activeOperationId!==null)throw new IntentStoreError("operation_in_progress");
    if(owned.policyRevision!==command.expectedPolicyRevision)throw new IntentStoreError("stale_calculation");
    if(command.calculationId){const [calculation]=await tx.select({revision:calculationSnapshots.policyRevision}).from(calculationSnapshots).where(and(eq(calculationSnapshots.id,command.calculationId),eq(calculationSnapshots.accountId,owned.id)));if(!calculation||calculation.revision!==owned.policyRevision)throw new IntentStoreError("stale_calculation");}
    const timestamp=now(),[row]=await tx.insert(investmentIntents).values({accountId:owned.id,operationKind:command.operationKind,assetId:command.assetId,requestedQty:command.requestedQty,qtyUnit:command.qtyUnit,calculationId:command.calculationId,policyRevision:owned.policyRevision,requestKey:command.requestKey,requestHash:hash,preparationSafety:fixtureMode?"contract_fixture":"unverified",createdAt:timestamp,updatedAt:timestamp}).returning();
    const claimed=await tx.update(gatewayAccounts).set({activeOperationId:row.id}).where(and(eq(gatewayAccounts.id,owned.id),isNull(gatewayAccounts.activeOperationId))).returning({activeOperationId:gatewayAccounts.activeOperationId});
    if(claimed.length!==1||claimed[0].activeOperationId!==row.id)throw new IntentStoreError("conflict");
    await audit(tx,context,row,"intent_claimed",{state:"DRAFT"},timestamp);
    return {intent:view(row),replayed:false};
   });
  },
  async get(context:OwnerContext,intentId:string){const key=id(intentId);return transaction(context,async tx=>{const owned=await account(tx,context,false);return view(await intent(tx,owned.id,key));});},
  async audit(context:OwnerContext,intentId:string){const key=id(intentId);return transaction(context,async tx=>{const owned=await account(tx,context,false);await intent(tx,owned.id,key);const rows=await tx.select({id:auditEvents.id,eventType:auditEvents.eventType,metadata:auditEvents.metadata,occurredAt:auditEvents.occurredAt}).from(auditEvents).where(and(eq(auditEvents.accountId,owned.id),eq(auditEvents.intentId,key))).orderBy(asc(auditEvents.sequence));return rows.map(row=>Object.freeze({...row,metadata:Object.freeze(row.metadata),occurredAt:row.occurredAt.toISOString()}));});},
  beginPreparation:(context:OwnerContext,intentId:string,expected:number)=>change(context,intentId,expected,async(tx,owned,row,timestamp)=>{
   current(owned,row,expected);
   const restart=row.state==="PREPARING"&&row.preparationSafety==="contract_fixture"&&row.preparationLeaseUntil!==null&&row.preparationLeaseUntil<=timestamp;
   if((row.state!=="DRAFT"&&!restart)||row.effectsPossible||row.providerOrderId!==null)throw new IntentStoreError("invalid_transition");
   if(row.policyRevision!==owned.policyRevision)throw new IntentStoreError("stale_calculation");
   if(row.preparationGeneration>=2147483647)throw new IntentStoreError("conflict");
   const updated=await save(tx,row,{state:"PREPARING",preparationGeneration:row.preparationGeneration+1,preparationLeaseUntil:new Date(timestamp.getTime()+30000)},timestamp);
   await audit(tx,context,updated,"preparation_started",{generation:updated.preparationGeneration},timestamp);return view(updated);
  }),
  async finishPreparation(context:OwnerContext,input:{id:string;expectedRevision:number;generation:number;providerOrderId:string;reviewExpiresAt:string}):Promise<{intent:IntentView;accepted:boolean}>{
   const command={...input};id(command.id);revision(command.expectedRevision);revision(command.generation);
   if(typeof command.providerOrderId!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(command.providerOrderId)||typeof command.reviewExpiresAt!=="string"||!Number.isFinite(Date.parse(command.reviewExpiresAt))||new Date(command.reviewExpiresAt).toISOString()!==command.reviewExpiresAt||Object.keys(command).length!==5)throw new IntentStoreError("invalid_request");
   return transaction(context,async tx=>{
    const owned=await account(tx,context,true),row=await intent(tx,owned.id,command.id),timestamp=now(),deadline=new Date(command.reviewExpiresAt);
    if(owned.activeOperationId!==row.id||row.state!=="PREPARING"||row.revision!==command.expectedRevision||row.preparationGeneration!==command.generation||row.preparationLeaseUntil===null||row.preparationLeaseUntil<=timestamp||row.policyRevision!==owned.policyRevision||deadline<=timestamp){
     await audit(tx,context,row,"preparation_response_ignored",{generation:command.generation,providerOrderId:command.providerOrderId},timestamp);return {intent:view(row),accepted:false};
    }
    if(deadline.getTime()>timestamp.getTime()+20000)throw new IntentStoreError("invalid_request");
    const safe=row.preparationSafety==="contract_fixture";
    const updated=await save(tx,row,{state:safe?"REVIEW_READY":"UNKNOWN",providerOrderId:command.providerOrderId,reviewExpiresAt:deadline,effectsPossible:!safe},timestamp);
    await audit(tx,context,updated,safe?"review_recorded":"preparation_unverified",{generation:command.generation,providerOrderId:command.providerOrderId},timestamp);return {intent:view(updated),accepted:safe};
   });
  },
  advance:(context:OwnerContext,intentId:string,expected:number,to:IntentState)=>change(context,intentId,expected,async(tx,owned,row,timestamp)=>{
   current(owned,row,expected);if(!canAdvance(row.state,to))throw new IntentStoreError("invalid_transition");
   if(to==="SUBMITTING"&&(row.preparationSafety!=="contract_fixture"||row.reviewExpiresAt===null||row.reviewExpiresAt<=timestamp||row.policyRevision!==owned.policyRevision))throw new IntentStoreError("invalid_transition");
   const updated=await save(tx,row,{state:to,effectsPossible:true},timestamp);await audit(tx,context,updated,"state_advanced",{from:row.state,to},timestamp);return view(updated);
  }),
  cleanup:(context:OwnerContext,intentId:string,expected:number)=>change(context,intentId,expected,async(tx,owned,row,timestamp)=>{
   const decision=cleanupDecision(view(row),owned.policyRevision,timestamp);if(!decision)return view(row);
   current(owned,row,expected);const updated=await save(tx,row,{state:decision.state,effectsPossible:row.effectsPossible||!decision.release},timestamp);
   if(decision.release)await release(tx,owned,updated);await audit(tx,context,updated,"cleanup_applied",{from:row.state,to:updated.state,released:decision.release},timestamp);return view(updated);
  }),
  abandon:(context:OwnerContext,intentId:string,expected:number)=>change(context,intentId,expected,async(tx,owned,row,timestamp)=>{
   current(owned,row,expected);if(row.effectsPossible||!["DRAFT","PREPARING","REVIEW_READY"].includes(row.state))throw new IntentStoreError("invalid_transition");
   const safe=row.state==="DRAFT"||row.preparationSafety==="contract_fixture",updated=await save(tx,row,{state:safe?"ABANDONED":"UNKNOWN",effectsPossible:!safe},timestamp);
   if(safe)await release(tx,owned,updated);await audit(tx,context,updated,"intent_abandoned",{released:safe},timestamp);return view(updated);
  }),
  rejectPreparation:(context:OwnerContext,intentId:string,expected:number)=>change(context,intentId,expected,async(tx,owned,row,timestamp)=>{
   current(owned,row,expected);if(row.state!=="PREPARING"||row.effectsPossible)throw new IntentStoreError("invalid_transition");
   const safe=row.preparationSafety==="contract_fixture",updated=await save(tx,row,{state:safe?"REJECTED":"UNKNOWN",effectsPossible:!safe},timestamp);
   if(safe)await release(tx,owned,updated);await audit(tx,context,updated,"preparation_rejected",{released:safe},timestamp);return view(updated);
  }),
 };
}
