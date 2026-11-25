import type { AllowanceInput, AllowanceResult } from "./types";
import type { PlanView } from "./storage-types";

export type FixtureBalanceInput = { available: string; listingId: string; chain: string; venue: string };
export type BalanceEvidence = Readonly<FixtureBalanceInput & { id: string; source: "fixture"; observedAt: string }>;
export type CalculationInput = AllowanceInput & Readonly<{ timezone: string; commitments: ReadonlyArray<Readonly<PlanView["commitments"][number]>> }>;
export type CalculationSnapshot = Readonly<{
  id: string; source: "fixture"; balance: BalanceEvidence; policyRevision: number;
  input: CalculationInput; result: AllowanceResult; horizonEnd: string; createdAt: string;
}>;
export type SnapshotReason = "policy_changed" | "timezone_changed" | "date_changed" | "balance_changed" | "balance_expired" | "operation_in_progress" | "fixture_only";
export type CalculationStatus = Readonly<{ current: boolean; canAuthorize: false; reason: SnapshotReason }>;
export type CalculationStoreCode = "invalid_request" | "not_found" | "conflict" | "plan_required" | "operation_in_progress" | "balance_expired" | "balance_changed" | "unavailable";
const messages: Record<CalculationStoreCode, string> = {
  invalid_request: "Calculation request is invalid", not_found: "Calculation evidence was not found",
  conflict: "Your plan changed; reload it before calculating again", plan_required: "Confirm your planning policy before calculating",
  operation_in_progress: "Calculation is unavailable while an account operation is active",
  balance_expired: "Balance evidence must be refreshed", balance_changed: "New balance evidence is available; recalculate",
  unavailable: "Calculation data is temporarily unavailable",
};
export class CalculationStoreError extends Error {
  constructor(readonly code: CalculationStoreCode) { super(messages[code]); this.name = "CalculationStoreError"; }
}
