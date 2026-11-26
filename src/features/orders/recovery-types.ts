import type { IntentState } from "./types";
export const providerOrderStatuses = ["initialized", "pending", "active", "cancel_pending", "complete", "failed", "canceled"] as const;
export type ProviderOrderStatus = typeof providerOrderStatuses[number];
export type RecoveryBinding = Readonly<{
  providerOrderId: string;
  providerUserId: string;
  assetId: string;
  requestedQty: string;
  quoteAsset: string;
  baseDecimals: number;
}>;
export type RecoveryEvidence = Readonly<{
  providerStatus: ProviderOrderStatus;
  filledBase: string | null;
  remainingBase: string | null;
  averagePriceQuote: string | null;
  feeQuote: string | null;
  partial: boolean | null;
}>;
export type RecoveryReadResult = Readonly<{
  source: "contract_fixture";
  kind: "response";
  body: unknown;
} | {
  source: "contract_fixture";
  kind: "unavailable" | "not_found";
}>;
export type RecoveryKind = "observed" | "initialized" | "unavailable" | "not_found" | "invalid_response";
export type RecoveryDisposition = "applied" | "ignored" | "conflict";
export type RecoveryView = Readonly<{
  intentId: string;
  state: IntentState;
  evidence: RecoveryEvidence | null;
  latest: {
    readId: string;
    kind: RecoveryKind;
    disposition: RecoveryDisposition;
    observedAt: string;
  } | null;
  requiresManualReview: boolean;
  slotHeld: boolean;
  settlementVerified: false;
  canExecute: false;
  source: "contract_fixture";
}>;
export class RecoveryError extends Error {
  constructor(readonly code: "disabled" | "invalid_request" | "not_found" | "conflict" | "unavailable") {
    super("Order recovery is unavailable");
    this.name = "RecoveryError";
  }
}
