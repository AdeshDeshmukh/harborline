import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { DatabaseError, getDatabase } from "../../server/db";
import { balanceSnapshots, calculationSnapshots, gatewayAccounts, investmentIntents, orderReviews, profiles } from "../../server/db/schema";
import { isUuid } from "../../server/env";
import { localDateAt, validateTimezone } from "../planning/validation";
import type { OwnerContext } from "../identity/access.server";
import type { ReviewScreen } from "./screen-types";
import { ReviewError } from "./review-types";
import { projectStoredReview } from "./reviews.server";
import { projectReviewScreen } from "./review-screen";

export function createReviewScreenReader(database:ReturnType<typeof getDatabase>=getDatabase(),clock:()=>Date=()=>new Date()){
  return {async load(context:OwnerContext,intentId:string):Promise<ReviewScreen>{
    if(!isUuid(intentId))throw new ReviewError("not_found");
    let domain:ReviewError|undefined;
    try{return await database.withOwner(context.ownerId,async tx=>{try{
      await tx.execute(sql`SET LOCAL lock_timeout='3s'`);
      await tx.execute(sql`SET LOCAL statement_timeout='5s'`);
      const [account]=await tx.select().from(gatewayAccounts).where(and(eq(gatewayAccounts.id,context.accountId),eq(gatewayAccounts.ownerId,context.ownerId))).for("share");
      if(!account||account.externalRefId!==context.externalRefId)throw new ReviewError("not_found");
      const [intent]=await tx.select().from(investmentIntents).where(and(eq(investmentIntents.id,intentId),eq(investmentIntents.accountId,account.id)));
      if(!intent)throw new ReviewError("not_found");
      // Select public terms only. Ciphertext, nonce/tag and key version never
      // enter the reader's result or the server-component props.
      const [stored]=await tx.select({intentId:orderReviews.intentId,revision:orderReviews.revision,terms:orderReviews.terms,termsHash:orderReviews.termsHash,maximumDebit:orderReviews.maximumDebit,expiresAt:orderReviews.expiresAt})
        .from(orderReviews).where(and(eq(orderReviews.intentId,intent.id),eq(orderReviews.accountId,account.id))).orderBy(desc(orderReviews.revision)).limit(1);
      const now=clock();if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw new ReviewError("unavailable");
      let policyChanged=false,balanceCurrent=false,balanceValidUntil:string|null=null;
      if(stored){
        if(stored.terms.binding.accountId!==account.id||stored.terms.binding.intentId!==intent.id||stored.terms.binding.calculationId!==intent.calculationId)throw new ReviewError("unavailable");
        const [calculation]=await tx.select().from(calculationSnapshots).where(and(eq(calculationSnapshots.id,intent.calculationId!),eq(calculationSnapshots.accountId,account.id)));
        const [profile]=await tx.select({timezone:profiles.timezone}).from(profiles).where(eq(profiles.authUserId,context.ownerId)).for("share");
        if(!calculation||!profile)throw new ReviewError("unavailable");
        policyChanged=account.policyRevision!==stored.terms.binding.policyRevision||calculation.policyRevision!==account.policyRevision||calculation.input.timezone!==profile.timezone||calculation.input.asOfLocalDate!==localDateAt(now,validateTimezone(profile.timezone));
        const [balance]=await tx.select().from(balanceSnapshots).where(and(eq(balanceSnapshots.id,calculation.balanceSnapshotId),eq(balanceSnapshots.accountId,account.id)));
        const [latest]=await tx.select({id:balanceSnapshots.id}).from(balanceSnapshots).where(eq(balanceSnapshots.accountId,account.id)).orderBy(desc(balanceSnapshots.sequence)).limit(1);
        const age=balance?now.getTime()-balance.observedAt.getTime():Infinity;
        balanceValidUntil=balance?new Date(balance.observedAt.getTime()+15000).toISOString():null;
        balanceCurrent=!!balance&&balance.source==="fixture"&&balance.listingId===stored.terms.quote.cashId&&balance.chain==="solana"&&balance.venue==="defi"&&latest?.id===balance.id&&age>=0&&age<=15000;
      }
      return projectReviewScreen({scope:account.id,intentId:intent.id,intentState:intent.state,review:stored?projectStoredReview(stored):null,policyChanged,balanceCurrent,balanceValidUntil,slotMatches:account.activeOperationId===intent.id,generationMatches:!!stored&&stored.revision===intent.preparationGeneration&&stored.terms.binding.generation===intent.preparationGeneration,serverNow:now.toISOString()});
    }catch(error){if(error instanceof ReviewError){domain=error;throw new DatabaseError("operation_failed");}throw error;}});}
    catch{if(domain)throw domain;throw new ReviewError("unavailable");}
  }};
}
