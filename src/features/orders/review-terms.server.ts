import "server-only";
import { createHash } from "node:crypto";
import { isUuid } from "../../server/env";
import { assessFixtureTerms } from "../../integrations/truemarkets/quote-contracts";
import { validateUnsignedPayloads } from "../../integrations/truemarkets/preparation.server";
import { ReviewError, type PreparationObservation, type ReviewBinding, type ReviewTerms } from "./review-types";
import { parseAmount, subtractAmounts } from "../planning/money";
import type { AllowanceResult } from "../planning/types";
export function buildReviewTerms(binding: ReviewBinding, prepared: Extract<PreparationObservation,{kind:"prepared"}>, evidence: unknown, calculation: {available:string;result:AllowanceResult}, now: Date): {terms:ReviewTerms;termsHash:string} {
  try {
    if (![binding.accountId,binding.intentId,binding.calculationId].every(isUuid) || Object.keys(binding).length !== 5 ||
      ![binding.generation,binding.policyRevision].every(n=>Number.isInteger(n)&&n>0&&n<=2147483647) || !/^[A-Za-z0-9_-]{1,128}$/.test(prepared.providerOrderId)) throw new Error();
    const bounds=assessFixtureTerms(prepared.quote,evidence,calculation.result.debitBudget,now);
    if(bounds.kind!=="bounded_fixture")throw new Error();
    const cash=Object.freeze({available:parseAmount(calculation.available),commitments:parseAmount(calculation.result.commitmentsTotal),buffer:parseAmount(calculation.result.additionalBuffer),debitBudget:parseAmount(calculation.result.debitBudget),afterMaximumDebit:subtractAmounts(parseAmount(calculation.available),parseAmount(bounds.maximumDebit))});
    const terms:ReviewTerms=Object.freeze({version:1,source:"contract_fixture",contractRef:(evidence as {contractRef:string}).contractRef,binding:Object.freeze({...binding}),providerOrderId:prepared.providerOrderId,quote:prepared.quote,bounds,cash,payloadHashes:Object.freeze(validateUnsignedPayloads(prepared.payloads).map(item=>item.digest))});
    return Object.freeze({terms,termsHash:hashReviewTerms(terms)});
  } catch { throw new ReviewError("invalid_terms"); }
}
export function hashReviewTerms(terms:ReviewTerms):string {
  // Explicit fields keep object property order outside this module out of the hash.
  const b=terms.binding,q=terms.quote,c=terms.cash,t=terms.bounds;
  return createHash("sha256").update(JSON.stringify(["harborline-review-v1",terms.source,terms.contractRef,b.accountId,b.intentId,b.generation,b.policyRevision,b.calculationId,terms.providerOrderId,
    q.source,q.observedAt,q.stockId,q.stockAddress,q.cashId,q.baseDecimals,q.baseIdentifier,q.quoteIdentifier,q.requestedAmount,q.chain,q.venue,q.inputAmount,q.expectedOutput,q.feeAmount,q.feeAssetId,q.issues,q.fingerprint,
    t.quoteFingerprint,t.maximumDebit,t.validUntil,t.feeTreatment,c.available,c.commitments,c.buffer,c.debitBudget,c.afterMaximumDebit,terms.payloadHashes])).digest("hex");
}
