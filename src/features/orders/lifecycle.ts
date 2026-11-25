import { IntentStoreError, intentStates, type IntentState, type PreparationSafety } from "./types";
const edges: Partial<Record<IntentState, readonly IntentState[]>> = {
  REVIEW_READY:["SUBMITTING"],
  SUBMITTING:["PENDING","UNKNOWN","COMPLETE","FAILED","CANCELED","MANUAL_REVIEW"],
  PENDING:["UNKNOWN","COMPLETE","FAILED","CANCELED","MANUAL_REVIEW"],
  UNKNOWN:["PENDING","COMPLETE","FAILED","CANCELED","MANUAL_REVIEW"],
  MANUAL_REVIEW:["PENDING","COMPLETE","FAILED","CANCELED"],
};
export function canAdvance(from: IntentState, to: IntentState): boolean { return Object.hasOwn(edges,from) && (edges[from]?.includes(to) ?? false); }
export type CleanupBasis = { state: IntentState; effectsPossible: boolean; preparationSafety: PreparationSafety; createdAt: string; preparationLeaseUntil: string | null; reviewExpiresAt: string | null; policyRevision: number };
export function cleanupDecision(input: CleanupBasis, policyRevision: number, now: Date): { state: "ABANDONED" | "EXPIRED" | "UNKNOWN"; release: boolean } | null {
  if (!input || !intentStates.includes(input.state) || !Number.isFinite(now.getTime())) throw new IntentStoreError("invalid_request");
  if (input.effectsPossible || ["SUBMITTING","PENDING","UNKNOWN","COMPLETE","FAILED","CANCELED","MANUAL_REVIEW"].includes(input.state)) return null;
  const timestamp = (value: string | null) => { const n=value===null?NaN:Date.parse(value);if(!Number.isFinite(n))throw new IntentStoreError("invalid_request");return n; };
  if (input.state === "DRAFT") return now.getTime() >= timestamp(input.createdAt)+600000 ? {state:"ABANDONED",release:true} : null;
  const due = input.state === "PREPARING" ? now.getTime() >= timestamp(input.preparationLeaseUntil)
    : input.state === "REVIEW_READY" ? policyRevision !== input.policyRevision || now.getTime() >= timestamp(input.reviewExpiresAt) : false;
  return due ? input.preparationSafety === "contract_fixture" ? {state:"EXPIRED",release:true} : {state:"UNKNOWN",release:false} : null;
}
