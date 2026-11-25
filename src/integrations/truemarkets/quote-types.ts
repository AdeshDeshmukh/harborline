import type { ReadSource, SupportedAssets } from "./read-types";
export type QuoteContext = Readonly<{ source: ReadSource; assets: SupportedAssets; observedAt: string; baseIdentifier: string; quoteIdentifier: string; side: "buy"; qtyUnit: "quote"; requestedAmount: string }>;
export type QuoteIdentity = Readonly<{ source: ReadSource; observedAt: string; stockId: string; stockAddress: string; cashId: string; baseDecimals: number; baseIdentifier: string; quoteIdentifier: string; requestedAmount: string; chain: "solana"; venue: "defi" }>;
export type PricePreview = QuoteIdentity & Readonly<{ kind: "nonbinding_preview"; expectedBaseQuantity: string; price: string; notional: string; feeAmount: string; feeAssetId: string; estimatedDebit: string; maximumDebit: null; expiresAt: null; canAuthorize: false }>;
export type DefiQuote = QuoteIdentity & Readonly<{ kind: "defi_quote_information"; inputAmount: string; expectedOutput: string; feeAmount: string; feeAssetId: string; issues: readonly string[]; fingerprint: string; canAuthorize: false }>;
export type QuoteCode = "invalid_quote" | "unsupported_route" | "fee_asset_mismatch" | "quote_issues" | "unverified_provider_contract" | "unverified_terms" | "invalid_evidence" | "terms_mismatch" | "stale_quote" | "inconsistent_bound" | "debit_exceeds_allowance";
export class QuoteContractError extends Error {
  constructor(readonly code: QuoteCode) { super("Quote terms could not be verified"); this.name = "QuoteContractError"; }
}
export type FixtureTerms = Readonly<{ source: "contract_fixture"; quoteFingerprint: string; contractRef: string; maximumDebit: string; expiresAt: string; feeTreatment: "added_to_input" | "included_in_input" }>;
export type QuoteAssessment = Readonly<{ kind: "blocked"; reason: QuoteCode; canAuthorize: false }> | Readonly<{ kind: "bounded_fixture"; source: "contract_fixture"; quoteFingerprint: string; maximumDebit: string; validUntil: string; feeTreatment: FixtureTerms["feeTreatment"]; canAuthorize: false }>;
