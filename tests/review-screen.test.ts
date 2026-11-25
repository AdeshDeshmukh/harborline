import { expect, test, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { projectReviewScreen, reviewStatusAt, exactDisplayAmount } from "../src/features/orders/review-screen";
import { normalizePreparationResponse } from "../src/integrations/truemarkets/preparation.server";
import { buildReviewTerms } from "../src/features/orders/review-terms.server";
import { calculateAllowance } from "../src/features/planning/calculate-allowance";
import type { ReviewEvidence } from "../src/features/orders/screen-types";
import { binding, quoteContext, response } from "./fixtures/investment-review";

function evidence(): ReviewEvidence {
  const prepared=normalizePreparationResponse(response(),quoteContext); if(prepared.kind!=="prepared")throw new Error("fixture");
  const calculation={available:"2000",result:calculateAllowance({available:"2000",additionalBuffer:"500",asOfLocalDate:"2026-11-25",horizonDays:30,policyRevision:2,commitments:[{id:"rent",amount:"1200",dueDate:"2026-11-26",status:"outstanding"}]})};
  const {terms,termsHash}=buildReviewTerms(binding,prepared,{source:"contract_fixture",quoteFingerprint:prepared.quote.fingerprint,contractRef:"fixture",maximumDebit:"100.5",expiresAt:"2026-11-25T12:00:20.000Z",feeTreatment:"added_to_input"},calculation,new Date(quoteContext.observedAt));
  return {scope:binding.accountId,intentId:binding.intentId,intentState:"REVIEW_READY",policyChanged:false,balanceCurrent:true,balanceValidUntil:"2026-11-25T12:00:20.000Z",slotMatches:true,generationMatches:true,serverNow:"2026-11-25T12:00:05.000Z",review:{operationKind:"buy",feeTreatment:terms.bounds.feeTreatment,blockingReasons:["fixture_only"],intentId:binding.intentId,reviewRevision:1,termsHash,source:"contract_fixture",providerOrderId:prepared.providerOrderId,quote:terms.quote,maximumDebit:terms.bounds.maximumDebit,localExpiresAt:terms.bounds.validUntil,cash:terms.cash,canApprove:false,canExecute:false}};
}
test("current saved terms preserve exact cash impact while approval stays unavailable",()=>{
  const input=evidence(),screen=projectReviewScreen(input);
  expect(screen).toMatchObject({status:"current",canProceed:false,review:{maximumDebit:"100.5",cash:{available:"2000",commitments:"1200",buffer:"500",afterMaximumDebit:"1899.5"}}});
  expect(screen.review).toEqual(input.review);expect(JSON.stringify(screen)).not.toContain("payload");
});
test.each([
  [{policyChanged:true},"changed_plan"], [{balanceCurrent:false},"stale_balance"], [{slotMatches:false},"superseded"], [{generationMatches:false},"superseded"],
  [{intentState:"UNKNOWN"},"uncertain"], [{intentState:"PENDING"},"uncertain"], [{intentState:"SUBMITTING"},"uncertain"], [{intentState:"EXPIRED"},"expired"], [{intentState:"ABANDONED"},"closed"],
  [{intentState:"PREPARING",review:null},"preparing"], [{review:null},"missing"],
] as const)("context %j cannot proceed",(changed,status)=>{
  expect(projectReviewScreen({...evidence(),...changed} as ReviewEvidence)).toMatchObject({status,canProceed:false});
});
test("expiry is exclusive and never reclassifies uncertain financial state as safe expiry",()=>{
  const screen=projectReviewScreen(evidence());
  expect(reviewStatusAt(screen,Date.parse("2026-11-25T12:00:19.999Z"))).toBe("current");
  expect(reviewStatusAt(screen,Date.parse("2026-11-25T12:00:20.000Z"))).toBe("expired");
  const unknown=projectReviewScreen({...evidence(),intentState:"UNKNOWN"});expect(reviewStatusAt(unknown,Date.parse("2026-11-26T12:00:00.000Z"))).toBe("uncertain");
});
test("malformed and backwards timing cannot be presented as current terms",()=>{
  expect(projectReviewScreen({...evidence(),serverNow:"invalid"}).status).toBe("unavailable");
  expect(projectReviewScreen({...evidence(),serverNow:"2026-11-25T11:59:59.000Z"}).status).toBe("unavailable");
});
test("fees and debit bounds never lose authoritative decimal precision in display",()=>{
  expect(exactDisplayAmount("100.000001")).toBe("100.000001");expect(exactDisplayAmount("1234567.5")).toBe("1,234,567.50");
  expect(exactDisplayAmount("0.000000001",0)).toBe("0.000000001");expect(exactDisplayAmount("0")).toBe("0.00");expect(()=>exactDisplayAmount("1e2")).toThrow();
});
test("ordinary unsigned expiry outranks its released operation slot",()=>{
  const screen=projectReviewScreen({...evidence(),intentState:"EXPIRED",slotMatches:false,serverNow:"2026-11-25T12:00:21.000Z"});
  expect(screen).toMatchObject({status:"expired",canProceed:false});
});
test("an older balance expires before a still-current quote",()=>{
  const screen=projectReviewScreen({...evidence(),balanceValidUntil:"2026-11-25T12:00:06.000Z"} as ReviewEvidence);
  expect(reviewStatusAt(screen,Date.parse("2026-11-25T12:00:06.000Z"))).toBe("current");
  expect(reviewStatusAt(screen,Date.parse("2026-11-25T12:00:06.001Z"))).toBe("stale_balance");
  expect(reviewStatusAt({...screen,status:"stale_balance"},Date.parse("2026-11-25T12:00:20.000Z"))).toBe("expired");
});
