export class DisposalError extends Error {
  constructor(readonly code: "invalid_request" | "wrong_owner" | "stale_evidence" | "invalid_terms" | "unverified" | "conflict") {
    super("Sell-back evidence could not be verified");
    this.name = "DisposalError";
  }
}
/** Internal normalized fixture contracts; these types do not authenticate a caller. */
export type DisposalBinding = Readonly<{
  ownerId: string; accountId: string; providerUserId: string; intentId: string;
  generation: number; policyRevision: number; assetId: string; assetAddress: string;
  cashId: string; baseDecimals: number;
}>;
export type DisposalBalance = Readonly<{
  source: "contract_fixture"; binding: DisposalBinding; assetId: string; address: string;
  chain: "solana"; venue: "defi"; decimals: number;
  available: string; held: string; total: string; observedAt: string;
}>;
export type DisposalQuote = Readonly<{
  source: "contract_fixture"; binding: DisposalBinding; contractRef: string;
  providerOrderId: string; side: "sell"; qtyUnit: "base";
  requestedBase: string; maximumBaseDebit: string; expectedGrossQuote: string;
  quotedFeeQuote: string; maximumFeeQuote: string; minimumNetQuote: string;
  feeAssetId: string; feeTreatment: "deducted_from_proceeds";
  observedAt: string; expiresAt: string; payloadDigests: readonly string[];
}>;
export type DisposalReview = Readonly<{
  kind: "disposal_fixture"; version: 1; source: "contract_fixture";
  binding: DisposalBinding; requestedBase: string; holding: DisposalBalance;
  quote: DisposalQuote; expectedNetQuote: string; createdAt: string;
  canApprove: false; canExecute: false;
}>;
export type DisposalActual = Readonly<{
  source: "contract_fixture"; binding: DisposalBinding; providerOrderId: string;
  status: "complete" | "failed" | "canceled";
  filledBase: string | null; remainingBase: string | null;
  grossQuote: string | null; feeQuote: string | null; averagePriceQuote: string | null;
  observedAt: string;
}>;
export type DisposalProof = Readonly<{
  source: "contract_fixture"; binding: DisposalBinding; providerOrderId: string;
  cashBefore: DisposalBalance; cashAfter: DisposalBalance; stockAfter: DisposalBalance;
  otherBaseCredits: string; otherBaseDebits: string;
  otherQuoteCredits: string; otherQuoteDebits: string;
}>;
export type DisposalReconciliation = Readonly<{
  kind: "reconciled_fixture"; source: "contract_fixture";
  status: DisposalActual["status"]; partial: boolean;
  actualBaseDebit: string; remainingBase: string; actualGrossQuote: string;
  actualFeeQuote: string; actualNetQuoteCredit: string;
  stockTotalBefore: string; stockTotalAfter: string; cashBefore: string; cashAfter: string;
  otherBaseCredits: string; otherBaseDebits: string;
  otherQuoteCredits: string; otherQuoteDebits: string;
  recordedAt: string; canRelease: false; canExecute: false;
}>;
