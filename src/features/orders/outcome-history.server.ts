import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { getDatabase } from "../../server/db";
import { auditEvents, orderRecoveryObservations } from "../../server/db/schema";
import type { IntentState } from "./types";

type Tx = Parameters<Parameters<ReturnType<typeof getDatabase>["withOwner"]>[1]>[0];
export type TerminalState = "COMPLETE" | "FAILED" | "CANCELED";
export function isTerminalState(state: string): state is TerminalState {
  return ["COMPLETE", "FAILED", "CANCELED"].includes(state);
}

// Call under the owned account lock. Manual state can hide an already observed
// terminal, so both GET history and the original dispatch response are fences.
export async function terminalOutcome(tx: Tx, accountId: string, intentId: string, state: IntentState): Promise<TerminalState | null> {
  if (isTerminalState(state)) return state;
  const [read] = await tx.select({ status: sql<string>`${orderRecoveryObservations.evidence}->>'providerStatus'` })
    .from(orderRecoveryObservations).where(and(
      eq(orderRecoveryObservations.accountId, accountId), eq(orderRecoveryObservations.intentId, intentId),
      eq(orderRecoveryObservations.kind, "observed"), eq(orderRecoveryObservations.disposition, "applied"),
      sql`${orderRecoveryObservations.evidence}->>'providerStatus' IN ('complete','failed','canceled')`,
    )).limit(1);
  if (read) return read.status.toUpperCase() as TerminalState;
  const [execution] = await tx.select({ status: sql<string>`${auditEvents.metadata}->>'providerStatus'` })
    .from(auditEvents).where(and(
      eq(auditEvents.accountId, accountId), eq(auditEvents.intentId, intentId),
      eq(auditEvents.eventType, "execution_observed"),
      sql`${auditEvents.metadata}->>'providerStatus' IN ('complete','failed','canceled')`,
      // HL-24 events predate the disposition field and were applied at write.
      sql`(${auditEvents.metadata}->>'disposition' IS NULL OR ${auditEvents.metadata}->>'disposition'='applied')`,
    )).limit(1);
  return execution ? execution.status.toUpperCase() as TerminalState : null;
}
