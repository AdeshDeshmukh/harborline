import type { IntentState } from "./types";

export type ApprovalCommand = Readonly<{ intentId: string; reviewRevision: number; termsHash: string; acknowledged: true }>;
/** Server-injected test evidence. Never accept this structure from an HTTP body. */
export type FixtureApprovalEvidence = Readonly<{
  source: "contract_fixture"; accountId: string; listingId: string;
  chain: "solana"; venue: "defi"; available: string; observedAt: string;
}>;
export type ApprovalReceipt = Readonly<{
  intentId: string; approvalId: string; attemptId: string; reviewRevision: number;
  termsHash: string; approvedAt: string; state: IntentState;
  source: "contract_fixture"; accepted: boolean; canExecute: false;
}>;
type ApprovalCode = "invalid_request" | "disabled" | "not_found" | "conflict" | "stale_inputs" | "unavailable";
const messages: Record<ApprovalCode, string> = {
  invalid_request: "Confirm the exact review before approving",
  disabled: "Approval is unavailable; live execution is disabled",
  not_found: "Approval review was not found",
  conflict: "This review changed or cannot be approved; reload it",
  stale_inputs: "Your cash or plan changed; a new review is required",
  unavailable: "Approval is temporarily unavailable",
};
export class ApprovalError extends Error {
  constructor(readonly code: ApprovalCode) { super(messages[code]); this.name = "ApprovalError"; }
}
