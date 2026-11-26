import "server-only";
import {and,desc,eq,sql} from "drizzle-orm";
import {DatabaseError,type getDatabase} from "../../server/db";
import {auditEvents,balanceSnapshots,calculationSnapshots,commitments,executionAttempts,executionDispatches,gatewayAccounts,investmentIntents,orderApprovals,orderReviews,planningPolicies,profiles} from "../../server/db/schema";
import type {OwnerContext} from "../identity/access.server";
import {ApprovalError} from "./approval-types";
import {normalizeApprovalCommand} from "./approval-command";
import {projectStoredReview} from "./reviews.server";
import {localDateAt,validateTimezone} from "../planning/validation";
import {calculateAllowance} from "../planning/calculate-allowance";
import {compareAmounts,parseAmount,subtractAmounts} from "../planning/money";
import {isTerminalState,terminalOutcome} from "./outcome-history.server";
type Tx=Parameters<Parameters<ReturnType<typeof getDatabase>["withOwner"]>[1]>[0];
type Account=typeof gatewayAccounts.$inferSelect;type Intent=typeof investmentIntents.$inferSelect;
export function createExecutionRepository(database:ReturnType<typeof getDatabase>,options:{clock:()=>Date;fixtureMode?:boolean;fixtureExecutionEnabled?:boolean}){
  function enabled(){if(options.fixtureMode!==true||options.fixtureExecutionEnabled!==true)throw new ApprovalError("disabled");}
  function time(){const n=options.clock();if(!(n instanceof Date)||!Number.isFinite(n.getTime()))throw new ApprovalError("unavailable");return new Date(n);}
  async function transaction<T>(ctx:OwnerContext,value:unknown,work:(tx:Tx,a:Account,i:Intent,c:ReturnType<typeof normalizeApprovalCommand>)=>Promise<T>){
    const c=normalizeApprovalCommand(value);let domain:ApprovalError|undefined;
    try{return await database.withOwner(ctx.ownerId,async tx=>{try{
      await tx.execute(sql`SET LOCAL lock_timeout='3s'`);await tx.execute(sql`SET LOCAL statement_timeout='5s'`);
      const [a]=await tx.select().from(gatewayAccounts).where(and(eq(gatewayAccounts.id,ctx.accountId),eq(gatewayAccounts.ownerId,ctx.ownerId))).for("update");
      if(!a||a.externalRefId!==ctx.externalRefId)throw new ApprovalError("not_found");
      const [i]=await tx.select().from(investmentIntents).where(and(eq(investmentIntents.id,c.intentId),eq(investmentIntents.accountId,a.id)));
      if(!i)throw new ApprovalError("not_found");return await work(tx,a,i,c);
    }catch(e){if(e instanceof ApprovalError){domain=e;throw new DatabaseError("operation_failed");}throw e;}});}catch{throw domain??new ApprovalError("unavailable");}
  }
  async function approved(tx:Tx,ctx:OwnerContext,i:Intent,c:ReturnType<typeof normalizeApprovalCommand>){
    const [a]=await tx.select().from(orderApprovals).where(and(eq(orderApprovals.intentId,i.id),eq(orderApprovals.accountId,ctx.accountId)));
    if(!a||a.ownerId!==ctx.ownerId||a.termsHash!==c.termsHash||a.reviewRevision!==c.reviewRevision||a.source!=="contract_fixture")throw new ApprovalError("conflict");
    const [attempt]=await tx.select().from(executionAttempts).where(and(eq(executionAttempts.approvalId,a.id),eq(executionAttempts.intentId,i.id),eq(executionAttempts.accountId,ctx.accountId)));
    if(!attempt||attempt.source!=="contract_fixture")throw new ApprovalError("conflict");return {approval:a,attempt};
  }
  async function basis(tx:Tx,ctx:OwnerContext,a:Account,i:Intent,c:ReturnType<typeof normalizeApprovalCommand>){
    const {approval,attempt}=await approved(tx,ctx,i,c);
    if(a.activeOperationId!==i.id||i.state!=="SUBMITTING"||!i.effectsPossible||i.preparationSafety!=="contract_fixture"||i.operationKind!=="buy"||!i.calculationId||a.provisioningState!=="READY"||!a.providerUserId||!a.publicKey)throw new ApprovalError("conflict");
    const [review]=await tx.select().from(orderReviews).where(and(eq(orderReviews.intentId,i.id),eq(orderReviews.revision,c.reviewRevision),eq(orderReviews.accountId,a.id)));
    if(!review||review.termsHash!==c.termsHash)throw new ApprovalError("conflict");
    const v=projectStoredReview(review),b=review.terms.binding;
    if(b.accountId!==a.id||b.intentId!==i.id||b.generation!==i.preparationGeneration||b.policyRevision!==i.policyRevision||b.calculationId!==i.calculationId||review.revision!==i.preparationGeneration||v.providerOrderId!==i.providerOrderId||v.quote.stockId!==i.assetId||v.quote.requestedAmount!==parseAmount(i.requestedQty)||review.expiresAt.getTime()!==i.reviewExpiresAt?.getTime())throw new ApprovalError("conflict");
    const [calc]=await tx.select().from(calculationSnapshots).where(and(eq(calculationSnapshots.id,i.calculationId),eq(calculationSnapshots.accountId,a.id)));
    const [profile]=await tx.select({timezone:profiles.timezone}).from(profiles).where(eq(profiles.authUserId,ctx.ownerId)).for("share");
    const [policy]=await tx.select().from(planningPolicies).where(eq(planningPolicies.accountId,a.id));
    const [balance]=await tx.select().from(balanceSnapshots).where(and(eq(balanceSnapshots.id,approval.balanceSnapshotId),eq(balanceSnapshots.accountId,a.id)));
    const [latest]=await tx.select({id:balanceSnapshots.id}).from(balanceSnapshots).where(eq(balanceSnapshots.accountId,a.id)).orderBy(desc(balanceSnapshots.sequence)).limit(1);
    const rows=await tx.select().from(commitments).where(eq(commitments.accountId,a.id));
    enabled();const now=time(),age=balance?now.getTime()-balance.observedAt.getTime():Infinity;
    if(review.expiresAt<=now||approval.approvedAt>now||!calc||!profile||!policy||a.policyRevision!==i.policyRevision||calc.policyRevision!==i.policyRevision||policy.revision!==i.policyRevision||profile.timezone!==calc.input.timezone||localDateAt(now,validateTimezone(profile.timezone))!==calc.input.asOfLocalDate||policy.horizonDays!==calc.input.horizonDays||!balance||latest?.id!==balance.id||balance.source!=="fixture"||balance.chain!=="solana"||balance.venue!=="defi"||balance.listingId!==v.quote.cashId||age<0||age>15000)throw new ApprovalError("stale_inputs");
    const result=calculateAllowance({available:balance.available,additionalBuffer:policy.additionalBuffer,commitments:rows,asOfLocalDate:calc.input.asOfLocalDate,horizonDays:policy.horizonDays,policyRevision:a.policyRevision});
    if(parseAmount(balance.available)!==v.cash.available||result.commitmentsTotal!==v.cash.commitments||result.additionalBuffer!==v.cash.buffer||result.debitBudget!==v.cash.debitBudget||compareAmounts(parseAmount(v.maximumDebit),result.debitBudget)>0||subtractAmounts(parseAmount(balance.available),parseAmount(v.maximumDebit))!==v.cash.afterMaximumDebit)throw new ApprovalError("stale_inputs");
    const expiresAt=review.expiresAt.getTime(),observedAt=balance.observedAt.getTime(),approvedAt=approval.approvedAt.getTime(),date=calc.input.asOfLocalDate,timezone=validateTimezone(profile.timezone);
    // A SQL check still awaits COMMIT. Keep a synchronous capability for the
    // final transport boundary so that commit/event-loop delay cannot preserve
    // an expired approval, stale cash, prior local date or disabled controls.
    const assertFresh=()=>{enabled();const at=time(),age=at.getTime()-observedAt;if(at.getTime()>=expiresAt||at.getTime()<approvedAt||age<0||age>15000||localDateAt(at,timezone)!==date)throw new ApprovalError("stale_inputs");};
    return {approval,attempt,review,now,assertFresh};
  }
  return {
    async claim(ctx:OwnerContext,value:unknown){enabled();return transaction(ctx,value,async(tx,a,i,c)=>{
      const {attempt}=await approved(tx,ctx,i,c);
      const [old]=await tx.select().from(executionDispatches).where(and(eq(executionDispatches.attemptId,attempt.id),eq(executionDispatches.accountId,a.id)));
      if(old)return null;
      const {review,now}=await basis(tx,ctx,a,i,c);
      await tx.insert(executionDispatches).values({attemptId:attempt.id,intentId:i.id,accountId:a.id,source:"contract_fixture",claimedAt:now});
      await tx.insert(auditEvents).values({accountId:a.id,intentId:i.id,actorId:ctx.ownerId,eventType:"execution_dispatch_claimed",metadata:{attemptId:attempt.id,source:"contract_fixture"},occurredAt:now});
      return {attemptId:attempt.id,intentId:i.id,termsHash:review.termsHash,providerOrderId:i.providerOrderId!,providerUserId:a.providerUserId!,publicKey:a.publicKey!,binding:review.terms.binding,payloadHashes:review.terms.payloadHashes,sealed:{ciphertext:review.payloadsEncrypted,nonce:review.nonce,tag:review.tag,keyVersion:review.encryptionKeyVersion}};
    });},
    async authorizeSend(ctx:OwnerContext,value:unknown,attemptId:string){enabled();return transaction(ctx,value,async(tx,a,i,c)=>{
      const [dispatch]=await tx.select().from(executionDispatches).where(and(eq(executionDispatches.attemptId,attemptId),eq(executionDispatches.accountId,a.id),eq(executionDispatches.intentId,i.id)));
      if(!dispatch)throw new ApprovalError("conflict");
      const {attempt,assertFresh}=await basis(tx,ctx,a,i,c);
      if(attempt.id!==attemptId)throw new ApprovalError("conflict");
      return {providerOrderId:i.providerOrderId!,providerUserId:a.providerUserId!,publicKey:a.publicKey!,assertFresh};
    });},
    async current(ctx:OwnerContext,value:unknown){return transaction(ctx,value,async(tx,_a,i,c)=>{await approved(tx,ctx,i,c);return i.state;});},
    async finish(ctx:OwnerContext,value:unknown,attemptId:string,status:"complete"|"pending"|"failed"|"canceled"|null){return transaction(ctx,value,async(tx,a,i,c)=>{
      const {attempt}=await approved(tx,ctx,i,c),[dispatch]=await tx.select().from(executionDispatches).where(and(eq(executionDispatches.attemptId,attempt.id),eq(executionDispatches.accountId,a.id)));
      if(attempt.id!==attemptId||!dispatch)throw new ApprovalError("conflict");
      if(a.activeOperationId!==i.id||!i.effectsPossible)throw new ApprovalError("conflict");
      if(!["SUBMITTING","PENDING","UNKNOWN","MANUAL_REVIEW","COMPLETE","FAILED","CANCELED"].includes(i.state))throw new ApprovalError("conflict");
      const [same]=await tx.select({id:auditEvents.id}).from(auditEvents).where(and(eq(auditEvents.accountId,a.id),eq(auditEvents.intentId,i.id),eq(auditEvents.eventType,"execution_observed"),sql`${auditEvents.metadata}->>'attemptId'=${attemptId}`,sql`${auditEvents.metadata}->>'providerStatus' IS NOT DISTINCT FROM ${status}`)).limit(1);
      if(same)return;
      const mapped=status===null?null:({complete:"COMPLETE",pending:"PENDING",failed:"FAILED",canceled:"CANCELED"} as const)[status],terminal=await terminalOutcome(tx,a.id,i.id,i.state),now=time();
      const disposition=terminal&&(mapped===null||mapped!==terminal)?mapped&&isTerminalState(mapped)?"conflict":"ignored":"applied";
      // A GET may finish before the original POST. Persist its definitive reply
      // without regressing terminal/manual state or treating a timeout as failure.
      const state=i.state==="MANUAL_REVIEW"?i.state:disposition==="applied"&&mapped?mapped:status===null&&i.state==="SUBMITTING"?"UNKNOWN":i.state;
      if(disposition!=="ignored"){
        const changed=await tx.update(investmentIntents).set({state,revision:i.revision+1,updatedAt:now}).where(and(eq(investmentIntents.id,i.id),eq(investmentIntents.revision,i.revision),eq(investmentIntents.state,i.state))).returning({id:investmentIntents.id});
        if(changed.length!==1)throw new ApprovalError("conflict");
      }
      await tx.insert(auditEvents).values({accountId:a.id,intentId:i.id,actorId:ctx.ownerId,eventType:"execution_observed",metadata:{attemptId,providerStatus:status,disposition,source:"contract_fixture"},occurredAt:now});
    });},
  };
}
