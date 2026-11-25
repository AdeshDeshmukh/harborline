import type { ReviewView } from "./review-types";
import type { IntentState } from "./types";

export type ReviewStatus = "current" | "expired" | "changed_plan" | "stale_balance" | "uncertain" | "closed" | "preparing" | "superseded" | "missing" | "unavailable";
export type ReviewEvidence = {
  scope: string;
  intentId: string;
  intentState: IntentState;
  review: ReviewView | null;
  policyChanged: boolean;
  balanceCurrent: boolean;
  balanceValidUntil: string | null;
  slotMatches: boolean;
  generationMatches: boolean;
  serverNow: string;
};
export type ReviewScreen = {
  scope: string;
  intentId: string;
  status: ReviewStatus;
  review: ReviewView | null;
  serverNow: string;
  sample: boolean;
  balanceValidUntil: string | null;
  canProceed: false;
};
export type ReviewScreenResponse = { ok: true; screen: ReviewScreen } | { ok: false; code: "unauthenticated" | "session_changed" | "not_found" | "unavailable"; message: string };
