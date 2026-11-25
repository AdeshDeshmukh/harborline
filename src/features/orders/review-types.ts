import type { DefiQuote, QuoteAssessment } from "../../integrations/truemarkets/quote-types";

export type Payload = Readonly<{ digest: string; payload: string }>;
export type PreparationObservation =
  | Readonly<{ kind: "prepared"; providerOrderId: string; quote: DefiQuote; payloads: readonly Payload[] }>
  | Readonly<{ kind: "rejected"; reason: "quote_only"; providerOrderId: null }>
  | Readonly<{ kind: "incident"; reason: "invalid_response" | "unexpected_execution"; providerOrderId: string | null }>;
export type ReviewBinding = Readonly<{ accountId: string; intentId: string; generation: number; policyRevision: number; calculationId: string }>;
export type CashImpact = Readonly<{ available: string; commitments: string; buffer: string; debitBudget: string; afterMaximumDebit: string }>;
export type BoundedTerms = Extract<QuoteAssessment, { kind: "bounded_fixture" }>;
export type ReviewTerms = Readonly<{ version: 1; source: "contract_fixture"; contractRef: string; binding: ReviewBinding; providerOrderId: string; quote: DefiQuote; bounds: BoundedTerms; cash: CashImpact; payloadHashes: readonly string[] }>;
export type ReviewView = Readonly<{ operationKind:"buy"; feeTreatment:BoundedTerms["feeTreatment"]; blockingReasons:readonly ["fixture_only"]; intentId: string; reviewRevision: number; termsHash: string; source: "contract_fixture"; providerOrderId: string; quote: DefiQuote; maximumDebit: string; localExpiresAt: string; cash: CashImpact; canApprove: false; canExecute: false }>;
export type SealedPayloads = Readonly<{ ciphertext: Buffer; nonce: Buffer; tag: Buffer; keyVersion: number }>;
export type ReviewCode = "integration_unverified" | "invalid_request" | "stale_inputs" | "invalid_terms" | "not_found" | "unavailable";
export class ReviewError extends Error {
  constructor(readonly code: ReviewCode) { super("Investment review is unavailable"); this.name = "ReviewError"; }
}
