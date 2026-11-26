import "server-only";
import {and,eq,sql} from "drizzle-orm";
import {auditEvents} from "../../server/db/schema";
import type {SaleTx} from "./disposal-store.server";
/** Append-only generation fence, shared by sale and generic intent release paths. */
export async function hasSalePreparationAttempt(tx:SaleTx,accountId:string,intentId:string,generation:number){
 const [mark]=await tx.select({id:auditEvents.id}).from(auditEvents).where(and(eq(auditEvents.accountId,accountId),eq(auditEvents.intentId,intentId),eq(auditEvents.eventType,"sale_preparation_authorized"),sql`${auditEvents.metadata}->>'generation'=${String(generation)}`)).limit(1);return !!mark;
}
