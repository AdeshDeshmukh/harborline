import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { DatabaseError, getDatabase } from "../../server/db";
import { auditEvents, balanceSnapshots, calculationSnapshots, gatewayAccounts, investmentIntents, orderReviews, profiles } from "../../server/db/schema";
import { isUuid } from "../../server/env";
import { localDateAt, validateTimezone } from "../planning/validation";
import { parseAmount } from "../planning/money";
import type { OwnerContext } from "../identity/access.server";
import { ReviewError, type PreparationObservation, type ReviewView } from "./review-types";
import type { createReviewVault } from "./review-vault.server";
import { buildReviewTerms, hashReviewTerms } from "./review-terms.server";
export type ReviewCompletion = {intentId:string;expectedRevision:number;generation:number;prepared:Extract<PreparationObservation,{kind:"prepared"}>;evidence:unknown};
export type Incident = {intentId:string;expectedRevision:number;generation:number;reason:"quote_only"|"invalid_response"|"unexpected_execution"|"timeout"|"invalid_terms";providerOrderId:string|null};
type Tx=Parameters<Parameters<ReturnType<typeof getDatabase>["withOwner"]>[1]>[0];
type Intent=typeof investmentIntents.$inferSelect;
type StoredReview=typeof orderReviews.$inferSelect;
function view(row:StoredReview):ReviewView {
  if(hashReviewTerms(row.terms)!==row.termsHash)throw new ReviewError("unavailable");
  return Object.freeze({operationKind:"buy",feeTreatment:row.terms.bounds.feeTreatment,blockingReasons:Object.freeze(["fixture_only"] as const),intentId:row.intentId,reviewRevision:row.revision,termsHash:row.termsHash,source:"contract_fixture",providerOrderId:row.terms.providerOrderId,quote:row.terms.quote,maximumDebit:parseAmount(row.maximumDebit),localExpiresAt:row.expiresAt.toISOString(),cash:row.terms.cash,canApprove:false,canExecute:false});
}
export function createReviewRepository(database:ReturnType<typeof getDatabase>,options:{clock:()=>Date;vault:ReturnType<typeof createReviewVault>}) {
  async function transaction<T>(context:OwnerContext,intentId:string,work:(tx:Tx,account:typeof gatewayAccounts.$inferSelect,intent:Intent,now:Date)=>Promise<T>):Promise<T>{
    if(!isUuid(intentId))throw new ReviewError("invalid_request");
    let domain:ReviewError|undefined;
    try{return await database.withOwner(context.ownerId,async tx=>{try{
      await tx.execute(sql`SET LOCAL lock_timeout='3s'`);await tx.execute(sql`SET LOCAL statement_timeout='5s'`);
      const [account]=await tx.select().from(gatewayAccounts).where(and(eq(gatewayAccounts.id,context.accountId),eq(gatewayAccounts.ownerId,context.ownerId))).for("update");
      if(!account||account.externalRefId!==context.externalRefId)throw new ReviewError("not_found");
      const [intent]=await tx.select().from(investmentIntents).where(and(eq(investmentIntents.id,intentId),eq(investmentIntents.accountId,account.id)));
      if(!intent)throw new ReviewError("not_found");
      const now=options.clock();if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw new ReviewError("unavailable");
      return await work(tx,account,intent,new Date(now));
    }catch(error){if(error instanceof ReviewError){domain=error;throw new DatabaseError("operation_failed");}throw error;}});}
    catch{if(domain)throw domain;throw new ReviewError("unavailable");}
  }
  async function basis(tx:Tx,context:OwnerContext,account:typeof gatewayAccounts.$inferSelect,intent:Intent,now:Date){
    const [calculation]=await tx.select().from(calculationSnapshots).where(and(eq(calculationSnapshots.id,intent.calculationId!),eq(calculationSnapshots.accountId,account.id)));
    const [profile]=await tx.select({timezone:profiles.timezone}).from(profiles).where(eq(profiles.authUserId,context.ownerId)).for("share");
    if(!calculation||!profile||account.policyRevision!==intent.policyRevision||calculation.policyRevision!==intent.policyRevision||calculation.input.timezone!==profile.timezone||calculation.input.asOfLocalDate!==localDateAt(now,validateTimezone(profile.timezone)))throw new ReviewError("stale_inputs");
    const [balance]=await tx.select().from(balanceSnapshots).where(and(eq(balanceSnapshots.id,calculation.balanceSnapshotId),eq(balanceSnapshots.accountId,account.id)));
    const [latest]=await tx.select({id:balanceSnapshots.id}).from(balanceSnapshots).where(eq(balanceSnapshots.accountId,account.id)).orderBy(desc(balanceSnapshots.sequence)).limit(1);
    const age=balance?now.getTime()-balance.observedAt.getTime():Infinity;
    if(!balance||balance.source!=="fixture"||balance.chain!=="solana"||balance.venue!=="defi"||latest?.id!==balance.id||age<0||age>15000||parseAmount(balance.available)!==calculation.input.available)throw new ReviewError("stale_inputs");
    return {calculation,balance};
  }
  async function audit(tx:Tx,context:OwnerContext,intent:Intent,type:string,metadata:Record<string,string|number|boolean|null>,now:Date){await tx.insert(auditEvents).values({accountId:context.accountId,intentId:intent.id,actorId:context.ownerId,eventType:type,metadata,occurredAt:now});}
  function matches(account:typeof gatewayAccounts.$inferSelect,intent:Intent,input:{expectedRevision:number;generation:number}){return account.activeOperationId===intent.id&&intent.state==="PREPARING"&&intent.revision===input.expectedRevision&&intent.preparationGeneration===input.generation&&!intent.effectsPossible;}
  function completion(input:{expectedRevision:number;generation:number}){if(![input.expectedRevision,input.generation].every(n=>Number.isInteger(n)&&n>0&&n<2147483647))throw new ReviewError("invalid_request");}
  return {
    async current(context:OwnerContext,intentId:string){return transaction(context,intentId,async(tx,account,intent)=>{
      const [row]=await tx.select().from(orderReviews).where(and(eq(orderReviews.intentId,intent.id),eq(orderReviews.accountId,account.id))).orderBy(desc(orderReviews.revision)).limit(1);
      return {intentId:intent.id,state:intent.state,review:row?view(row):null,canApprove:false as const,canExecute:false as const};
    });},
    async inputs(context:OwnerContext,intentId:string){return transaction(context,intentId,async(tx,account,intent,now)=>{
      if(account.activeOperationId!==intent.id||intent.preparationSafety!=="contract_fixture"||intent.operationKind!=="buy"||!intent.calculationId)throw new ReviewError("integration_unverified");
      if(account.provisioningState!=="READY"||!account.providerUserId)throw new ReviewError("integration_unverified");
      const data=await basis(tx,context,account,intent,now);return {available:parseAmount(data.balance.available),result:data.calculation.result,providerUserId:account.providerUserId,balanceListingId:data.balance.listingId};
    });},
    async begin(context:OwnerContext,intentId:string,expectedRevision:number){return transaction(context,intentId,async(tx,account,intent,now)=>{
      if(account.activeOperationId!==intent.id||intent.state!=="DRAFT"||intent.revision!==expectedRevision||intent.effectsPossible||intent.providerOrderId!==null||intent.preparationGeneration>=2147483647)throw new ReviewError("stale_inputs");
      if(intent.preparationSafety!=="contract_fixture"||intent.operationKind!=="buy"||!intent.calculationId||account.provisioningState!=="READY"||!account.providerUserId)throw new ReviewError("integration_unverified");
      await basis(tx,context,account,intent,now);
      const [updated]=await tx.update(investmentIntents).set({state:"PREPARING",revision:intent.revision+1,preparationGeneration:intent.preparationGeneration+1,preparationLeaseUntil:new Date(now.getTime()+30000),updatedAt:now}).where(and(eq(investmentIntents.id,intent.id),eq(investmentIntents.revision,intent.revision),eq(investmentIntents.state,"DRAFT"))).returning();
      if(!updated)throw new ReviewError("stale_inputs");
      await audit(tx,context,intent,"preparation_started",{generation:updated.preparationGeneration},now);
      return {id:updated.id,revision:updated.revision,preparationGeneration:updated.preparationGeneration,providerUserId:account.providerUserId};
    });},
    async reject(context:OwnerContext,input:{intentId:string;expectedRevision:number;generation:number}){
      const command={...input};completion(command);
      return transaction(context,command.intentId,async(tx,account,intent,now)=>{
        if(!matches(account,intent,command)||!intent.preparationLeaseUntil||intent.preparationLeaseUntil<=now){await audit(tx,context,intent,"preparation_rejection_ignored",{generation:command.generation},now);return false;}
        if(intent.preparationSafety!=="contract_fixture")throw new ReviewError("integration_unverified");
        const updated=await tx.update(investmentIntents).set({state:"REJECTED",revision:intent.revision+1,updatedAt:now}).where(and(eq(investmentIntents.id,intent.id),eq(investmentIntents.revision,intent.revision))).returning({id:investmentIntents.id});
        const released=await tx.update(gatewayAccounts).set({activeOperationId:null}).where(and(eq(gatewayAccounts.id,account.id),eq(gatewayAccounts.activeOperationId,intent.id))).returning({id:gatewayAccounts.id});
        if(updated.length!==1||released.length!==1)throw new ReviewError("stale_inputs");
        await audit(tx,context,intent,"preparation_rejected",{generation:command.generation,released:true},now);return true;
      });
    },
    async record(context:OwnerContext,value:ReviewCompletion):Promise<{accepted:boolean;review:ReviewView|null}>{
      const input=structuredClone(value);completion(input);
      return transaction(context,input.intentId,async(tx,account,intent,now)=>{
        if(!matches(account,intent,input)||!intent.preparationLeaseUntil||intent.preparationLeaseUntil<=now){await audit(tx,context,intent,"review_response_ignored",{generation:input.generation,providerOrderId:input.prepared.providerOrderId},now);return {accepted:false,review:null};}
        if(intent.preparationSafety!=="contract_fixture"||intent.operationKind!=="buy"||!intent.calculationId)throw new ReviewError("integration_unverified");
        const data=await basis(tx,context,account,intent,now),quote=input.prepared.quote;
        if(quote.stockId!==intent.assetId||quote.requestedAmount!==parseAmount(intent.requestedQty)||quote.cashId!==data.balance.listingId)throw new ReviewError("invalid_terms");
        const binding={accountId:account.id,intentId:intent.id,generation:input.generation,policyRevision:intent.policyRevision,calculationId:intent.calculationId};
        const {terms,termsHash}=buildReviewTerms(binding,input.prepared,input.evidence,{available:data.balance.available,result:data.calculation.result},now),sealed=options.vault.seal(binding,termsHash,input.prepared.payloads);
        const [review]=await tx.insert(orderReviews).values({accountId:account.id,intentId:intent.id,revision:input.generation,terms,termsHash,maximumDebit:terms.bounds.maximumDebit,payloadsEncrypted:sealed.ciphertext,nonce:sealed.nonce,tag:sealed.tag,encryptionKeyVersion:sealed.keyVersion,createdAt:now,expiresAt:new Date(terms.bounds.validUntil)}).returning();
        const updated=await tx.update(investmentIntents).set({state:"REVIEW_READY",revision:intent.revision+1,providerOrderId:terms.providerOrderId,reviewExpiresAt:review.expiresAt,updatedAt:now}).where(and(eq(investmentIntents.id,intent.id),eq(investmentIntents.revision,intent.revision),eq(investmentIntents.state,"PREPARING"),eq(investmentIntents.preparationGeneration,input.generation))).returning({id:investmentIntents.id});
        if(updated.length!==1)throw new ReviewError("stale_inputs");
        await audit(tx,context,intent,"durable_review_recorded",{generation:input.generation,termsHash},now);return {accepted:true,review:view(review)};
      });
    },
    async get(context:OwnerContext,intentId:string):Promise<ReviewView|null>{return transaction(context,intentId,async(tx,account,intent)=>{const [row]=await tx.select().from(orderReviews).where(and(eq(orderReviews.intentId,intent.id),eq(orderReviews.accountId,account.id))).orderBy(desc(orderReviews.revision)).limit(1);return row?view(row):null;});},
    async incident(context:OwnerContext,value:Incident):Promise<boolean>{
      const input={...value};completion(input);
      if(!["quote_only","invalid_response","unexpected_execution","timeout","invalid_terms"].includes(input.reason)||input.providerOrderId!==null&&(typeof input.providerOrderId!=="string"||!input.providerOrderId.length||input.providerOrderId.length>128||/[^A-Za-z0-9_-]/.test(input.providerOrderId)))throw new ReviewError("invalid_request");
      return transaction(context,input.intentId,async(tx,account,intent,now)=>{
        const current=matches(account,intent,input);
        await audit(tx,context,intent,current?"preparation_incident":"preparation_incident_ignored",{reason:input.reason,generation:input.generation,providerOrderId:input.providerOrderId},now);
        if(!current)return false;
        // An observed reference is not a verified unique intent mapping. Keep
        // it in the audit so a cross-account ID collision cannot erase UNKNOWN.
        const rows=await tx.update(investmentIntents).set({state:"UNKNOWN",revision:intent.revision+1,effectsPossible:true,updatedAt:now}).where(and(eq(investmentIntents.id,intent.id),eq(investmentIntents.revision,intent.revision))).returning({id:investmentIntents.id});
        if(rows.length!==1)throw new ReviewError("stale_inputs");return true;
      });
    },
  };
}
