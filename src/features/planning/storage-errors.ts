export type PlanningStoreCode = "invalid_request" | "conflict" | "not_found" | "plan_required" | "operation_in_progress" | "unavailable";
const messages: Record<PlanningStoreCode, string> = {
  invalid_request: "Planning request is invalid",
  conflict: "Your plan changed; reload it before saving again",
  not_found: "Planning record was not found",
  plan_required: "Confirm your planning policy before adding commitments",
  operation_in_progress: "Plan changes are unavailable while an account operation is active",
  unavailable: "Planning data is temporarily unavailable",
};
export class PlanningStoreError extends Error {
  constructor(readonly code: PlanningStoreCode) { super(messages[code]); this.name = "PlanningStoreError"; }
}
