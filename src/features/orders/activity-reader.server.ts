import "server-only";
import {and,desc,eq,sql} from "drizzle-orm";
import {DatabaseError,getDatabase} from "../../server/db";
import {auditEvents,balanceSnapshots,calculationSnapshots,gatewayAccounts,investmentIntents,orderApprovals,orderRecoveryObservations,orderRecoveryReads,orderReviews,settlementBalances,settlementVerifications} from "../../server/db/schema";
import {isUuid} from "../../server/env";
import type {OwnerContext} from "../identity/access.server";
import {validateCalendarDate} from "../planning/validation";
import {parseAmount,addAmounts,subtractAmounts} from "../planning/money";
import {ActivityError,type ActivityPage,type ActivitySummary,type OrderRecord} from "./activity-types";
import {decodeActivityCursor,encodeActivityCursor} from "./activity-cursor.server";
import {projectActualEvidence} from "./activity-projection";
import {projectStoredReview} from "./reviews.server";
type Tx=Parameters<Parameters<ReturnType<typeof getDatabase>["withOwner"]>[1]>[0];
type Account=Pick<typeof gatewayAccounts.$inferSelect,"id"|"activeOperationId">;
const publicReview={intentId:orderReviews.intentId,revision:orderReviews.revision,terms:orderReviews.terms,termsHash:orderReviews.termsHash,maximumDebit:orderReviews.maximumDebit,expiresAt:orderReviews.expiresAt};
const summarySelection={id:investmentIntents.id,state:investmentIntents.state,source:investmentIntents.preparationSafety,requestedQuantity:investmentIntents.requestedQty,quantityUnit:investmentIntents.qtyUnit,assetId:investmentIntents.assetId,createdAt:investmentIntents.createdAt,updatedAt:investmentIntents.updatedAt,
 sortAt:sql<string>`to_char(${investmentIntents.createdAt} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
 requiresReview:sql<boolean>`(${investmentIntents.state}='MANUAL_REVIEW' OR EXISTS(SELECT 1 FROM ${orderRecoveryObservations} o WHERE o.account_id="investment_intents"."account_id" AND o.intent_id="investment_intents"."id" AND o.disposition='conflict') OR EXISTS(SELECT 1 FROM ${auditEvents} a WHERE a.account_id="investment_intents"."account_id" AND a.intent_id="investment_intents"."id" AND a.event_type='execution_observed' AND a.redacted_metadata->>'disposition'='conflict'))`,
 settlementVerified:sql<boolean>`EXISTS(SELECT 1 FROM ${settlementVerifications} v WHERE v.account_id="investment_intents"."account_id" AND v.intent_id="investment_intents"."id")`};
type SummaryRow={id:string;state:ActivitySummary["state"];source:ActivitySummary["source"];requestedQuantity:string;quantityUnit:ActivitySummary["quantityUnit"];assetId:string;createdAt:Date;updatedAt:Date;sortAt:string;requiresReview:boolean;settlementVerified:boolean};
function summary(r:SummaryRow,a:Account):ActivitySummary{return {id:r.id,state:r.state,source:r.source,requestedQuantity:parseAmount(r.requestedQuantity),quantityUnit:r.quantityUnit,assetId:r.assetId,assetLabel:null,quoteCurrency:null,createdAt:r.createdAt.toISOString(),updatedAt:r.updatedAt.toISOString(),requiresReview:r.requiresReview,settlementVerified:r.settlementVerified,reservationHeld:a.activeOperationId===r.id,canExecute:false};}
export function createActivityReader(database:ReturnType<typeof getDatabase>=getDatabase(),clock:()=>Date=()=>new Date()){
 async function transaction<T>(ctx:OwnerContext,work:(tx:Tx,a:Account)=>Promise<T>){
  let domain:ActivityError|undefined;
  try{return await database.withOwner(ctx.ownerId,async tx=>{try{
   await tx.execute(sql`SET LOCAL lock_timeout='3s'`);await tx.execute(sql`SET LOCAL statement_timeout='5s'`);
   const [a]=await tx.select({id:gatewayAccounts.id,activeOperationId:gatewayAccounts.activeOperationId,externalRefId:gatewayAccounts.externalRefId}).from(gatewayAccounts).where(and(eq(gatewayAccounts.id,ctx.accountId),eq(gatewayAccounts.ownerId,ctx.ownerId))).for("share");
   if(!a||a.externalRefId!==ctx.externalRefId)throw new ActivityError("not_found");
   if(!Number.isFinite(clock().getTime()))throw new ActivityError("unavailable");
   return await work(tx,a);
  }catch(error){if(error instanceof ActivityError){domain=error;throw new DatabaseError("operation_failed");}throw error;}});}catch{throw domain??new ActivityError("unavailable");}
 }
 return {
  async list(ctx:OwnerContext,value?:string):Promise<ActivityPage>{
   const cursor=value===undefined?null:decodeActivityCursor(value,ctx.accountId);
   return transaction(ctx,async(tx,a)=>{
    const rows=await tx.select(summarySelection).from(investmentIntents).where(and(eq(investmentIntents.accountId,a.id),cursor?sql`(${investmentIntents.createdAt},${investmentIntents.id})<(${cursor.at}::timestamptz,${cursor.id}::uuid)`:undefined)).orderBy(desc(investmentIntents.createdAt),desc(investmentIntents.id)).limit(21);
    const visible=rows.slice(0,20),last=visible.at(-1);
    return {items:visible.map(r=>summary(r,a)),nextCursor:rows.length>20&&last?encodeActivityCursor({v:1,accountId:a.id,at:last.sortAt,id:last.id}):null};
   });
  },
  async load(ctx:OwnerContext,id:string):Promise<OrderRecord>{
   if(!isUuid(id))throw new ActivityError("not_found");
   id=id.toLowerCase();
   return transaction(ctx,async(tx,a)=>{
    const [i]=await tx.select({...summarySelection,providerOrderId:investmentIntents.providerOrderId,calculationId:investmentIntents.calculationId,policyRevision:investmentIntents.policyRevision,preparationGeneration:investmentIntents.preparationGeneration}).from(investmentIntents).where(and(eq(investmentIntents.id,id),eq(investmentIntents.accountId,a.id)));
    if(!i)throw new ActivityError("not_found");
    const [approved]=await tx.select({reviewRevision:orderApprovals.reviewRevision,termsHash:orderApprovals.termsHash,approvedAt:orderApprovals.approvedAt,balanceId:orderApprovals.balanceSnapshotId}).from(orderApprovals).where(and(eq(orderApprovals.intentId,id),eq(orderApprovals.accountId,a.id),eq(orderApprovals.ownerId,ctx.ownerId))).orderBy(desc(orderApprovals.reviewRevision)).limit(1);
    let approval:OrderRecord["approval"]=null,quoteCurrency:string|null=null;
    if(approved){
     const [review]=await tx.select(publicReview).from(orderReviews).where(and(eq(orderReviews.intentId,id),eq(orderReviews.accountId,a.id),eq(orderReviews.revision,approved.reviewRevision)));
     const [calculation]=i.calculationId?await tx.select({input:calculationSnapshots.input,policyRevision:calculationSnapshots.policyRevision,balanceId:calculationSnapshots.balanceSnapshotId}).from(calculationSnapshots).where(and(eq(calculationSnapshots.id,i.calculationId),eq(calculationSnapshots.accountId,a.id))):[];
     const [balance]=await tx.select({available:balanceSnapshots.available,listingId:balanceSnapshots.listingId}).from(balanceSnapshots).where(and(eq(balanceSnapshots.id,approved.balanceId),eq(balanceSnapshots.accountId,a.id)));
     if(!review||!calculation||!balance||review.termsHash!==approved.termsHash)throw new ActivityError("unavailable");
     const v=projectStoredReview(review),b=review.terms.binding;
     if(b.accountId!==a.id||b.intentId!==id||b.calculationId!==i.calculationId||b.policyRevision!==i.policyRevision||b.generation!==approved.reviewRevision||approved.reviewRevision!==i.preparationGeneration||calculation.policyRevision!==i.policyRevision||parseAmount(balance.available)!==v.cash.available||balance.listingId!==v.quote.cashId||v.providerOrderId!==i.providerOrderId||v.quote.chain!=="solana"||v.quote.quoteIdentifier!=="USDC"||v.quote.stockId!==i.assetId||v.quote.requestedAmount!==parseAmount(i.requestedQuantity))throw new ActivityError("unavailable");
     // Quote identification was validated when these immutable fixture terms were recorded.
     quoteCurrency=v.quote.quoteIdentifier;
     approval={approvedAt:approved.approvedAt.toISOString(),network:v.quote.chain,reviewRevision:review.revision,planningRevision:calculation.policyRevision,planningDate:validateCalendarDate(calculation.input.asOfLocalDate),maximumDebit:v.maximumDebit,cashBefore:v.cash.available,commitments:v.cash.commitments,buffer:v.cash.buffer,expectedQuantity:v.quote.expectedOutput!,quotedFee:v.quote.feeAmount!,quoteObservedAt:v.quote.observedAt};
    }
    const [proof]=await tx.select({observationId:settlementVerifications.observationId,readId:settlementVerifications.readId,baselineId:settlementVerifications.baselineBalanceId,verifiedAt:settlementVerifications.verifiedAt,actualDebit:settlementVerifications.actualDebit,interveningCredits:settlementVerifications.interveningCredits,interveningDebits:settlementVerifications.interveningDebits}).from(settlementVerifications).where(and(eq(settlementVerifications.accountId,a.id),eq(settlementVerifications.intentId,id)));
    const [known]=await tx.select({evidence:orderRecoveryObservations.evidence,at:orderRecoveryObservations.observedAt,readId:orderRecoveryObservations.readId}).from(orderRecoveryObservations).innerJoin(orderRecoveryReads,eq(orderRecoveryReads.id,orderRecoveryObservations.readId)).where(and(eq(orderRecoveryObservations.accountId,a.id),eq(orderRecoveryObservations.intentId,id),eq(orderRecoveryObservations.kind,"observed"),eq(orderRecoveryObservations.disposition,"applied"),proof?eq(orderRecoveryObservations.readId,proof.readId):undefined)).orderBy(desc(orderRecoveryReads.sequence)).limit(1);
    const [latest]=await tx.select({at:orderRecoveryObservations.observedAt,kind:orderRecoveryObservations.kind,disposition:orderRecoveryObservations.disposition}).from(orderRecoveryObservations).innerJoin(orderRecoveryReads,eq(orderRecoveryReads.id,orderRecoveryObservations.readId)).where(and(eq(orderRecoveryObservations.accountId,a.id),eq(orderRecoveryObservations.intentId,id))).orderBy(desc(orderRecoveryObservations.observedAt),desc(orderRecoveryReads.sequence)).limit(1);
    let settlement:OrderRecord["settlement"]=null;
    if(proof){
     const [post]=await tx.select({available:settlementBalances.available,held:settlementBalances.held,readId:settlementBalances.readId,observedAt:settlementBalances.observedAt}).from(settlementBalances).where(and(eq(settlementBalances.id,proof.observationId),eq(settlementBalances.intentId,id),eq(settlementBalances.accountId,a.id)));
     const [baseline]=await tx.select({available:balanceSnapshots.available,observedAt:balanceSnapshots.observedAt}).from(balanceSnapshots).where(and(eq(balanceSnapshots.id,proof.baselineId),eq(balanceSnapshots.accountId,a.id)));
     if(!approval||!known||!post||!baseline||post.readId!==proof.readId||parseAmount(post.held)!=="0"||parseAmount(baseline.available)!==parseAmount(post.available)||baseline.observedAt.getTime()!==post.observedAt.getTime()||proof.verifiedAt<post.observedAt)throw new ActivityError("unavailable");
     const actualDebit=parseAmount(parseAmount(proof.actualDebit),{scale:6}),interveningCredits=parseAmount(parseAmount(proof.interveningCredits),{scale:6}),interveningDebits=parseAmount(parseAmount(proof.interveningDebits),{scale:6});
     const reconciled=subtractAmounts(addAmounts([parseAmount(approval.cashBefore),interveningCredits]),addAmounts([actualDebit,interveningDebits]));
     if(reconciled!==parseAmount(post.available))throw new ActivityError("unavailable");
     settlement={method:"manual",verifiedAt:proof.verifiedAt.toISOString(),balanceObservedAt:post.observedAt.toISOString(),cashBefore:approval.cashBefore,cashAfter:parseAmount(post.available),actualDebit,interveningCredits,interveningDebits};
    }
    return {...summary(i,a),quoteCurrency,providerOrderId:i.providerOrderId,approval,actual:known?.evidence?projectActualEvidence(known.evidence,known.at.toISOString()):null,latestCheck:latest?{at:latest.at.toISOString(),kind:latest.kind,disposition:latest.disposition}:null,settlement,chainReference:null};
   });
  }
 };
}
