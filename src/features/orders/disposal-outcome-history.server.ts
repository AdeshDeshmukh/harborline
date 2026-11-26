import "server-only";
import {and,desc,eq,sql} from "drizzle-orm";
import {auditEvents,disposalOutcomes} from "../../server/db/schema";
import type {SaleTx,SaleAccount,SaleIntent} from "./disposal-store.server";
import {isTerminalState} from "./outcome-history.server";
export async function saleTerminal(tx:SaleTx,a:SaleAccount,i:SaleIntent){
 if(isTerminalState(i.state))return i.state;
 const [known]=await tx.select({evidence:disposalOutcomes.evidence}).from(disposalOutcomes).where(and(eq(disposalOutcomes.accountId,a.id),eq(disposalOutcomes.intentId,i.id),eq(disposalOutcomes.disposition,"applied"),eq(disposalOutcomes.kind,"observed"),sql`${disposalOutcomes.evidence}->>'providerStatus' IN ('complete','failed','canceled')`)).orderBy(desc(disposalOutcomes.observedAt)).limit(1);
 if(known?.evidence)return known.evidence.providerStatus.toUpperCase() as "COMPLETE"|"FAILED"|"CANCELED";
 const [post]=await tx.select({status:sql<string>`${auditEvents.metadata}->>'providerStatus'`}).from(auditEvents).where(and(eq(auditEvents.accountId,a.id),eq(auditEvents.intentId,i.id),eq(auditEvents.eventType,"execution_observed"),sql`${auditEvents.metadata}->>'disposition'='applied' AND ${auditEvents.metadata}->>'providerStatus' IN ('complete','failed','canceled')`)).limit(1);
 return post?post.status.toUpperCase() as "COMPLETE"|"FAILED"|"CANCELED":null;
}
