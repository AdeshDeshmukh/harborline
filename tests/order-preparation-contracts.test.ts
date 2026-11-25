import { expect, test, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { normalizePreparationResponse } from "../src/integrations/truemarkets/preparation.server";
import { createReviewVault } from "../src/features/orders/review-vault.server";
import { buildReviewTerms } from "../src/features/orders/review-terms.server";
import { calculateAllowance } from "../src/features/planning/calculate-allowance";
import { binding, payload, quoteContext, response } from "./fixtures/investment-review";

test("unsigned DeFi response preserves exact payload bytes and trailing newline",()=>{
  const raw = response(), result = normalizePreparationResponse(raw,quoteContext);
  expect(result).toMatchObject({kind:"prepared",providerOrderId:"fixture_order_1",payloads:[{payload:'{"fixture":"unsigned-only"}\n'}]});
  raw.payloads[0].payload = "changed";
  if(result.kind === "prepared") expect(result.payloads[0].payload).toBe('{"fixture":"unsigned-only"}\n');
});
test("review hash binds ordered payloads, owner context, calculation and economic terms",()=>{
  const prepared=normalizePreparationResponse(response(),quoteContext);if(prepared.kind!=="prepared")throw new Error("fixture");
  const evidence={source:"contract_fixture",quoteFingerprint:prepared.quote.fingerprint,contractRef:"fixture-only",maximumDebit:"100.5",expiresAt:"2026-11-25T12:00:30.000Z",feeTreatment:"added_to_input"};
  const calculation={available:"2000",result:calculateAllowance({available:"2000",additionalBuffer:"100",asOfLocalDate:"2026-11-25",horizonDays:30,policyRevision:2,commitments:[{id:binding.intentId,amount:"1000",dueDate:"2026-11-26",status:"outstanding"}]})};
  const build=(b=binding,p=prepared,e=evidence,c=calculation)=>buildReviewTerms(b,p,e,c,new Date(quoteContext.observedAt));
  const original=build();expect(original.terms.cash).toEqual({available:"2000",commitments:"1000",buffer:"100",debitBudget:"900",afterMaximumDebit:"1899.5"});
  expect(original.termsHash).toMatch(/^[0-9a-f]{64}$/);
  for(const b of [{...binding,generation:2},{...binding,accountId:binding.intentId},{...binding,calculationId:binding.intentId},{...binding,policyRevision:3}])expect(build(b).termsHash).not.toBe(original.termsHash);
  expect(build(binding,{...prepared,providerOrderId:"another_order"}).termsHash).not.toBe(original.termsHash);
  expect(build(binding,{...prepared,payloads:[...prepared.payloads,payload("second\n")]}).termsHash).not.toBe(original.termsHash);
  expect(build(binding,prepared,{...evidence,maximumDebit:"101"}).termsHash).not.toBe(original.termsHash);
  expect(build(binding,prepared,{...evidence,contractRef:"different-fixture-contract"}).termsHash).not.toBe(original.termsHash);
  const pair=[payload(),payload("second\n")];expect(build(binding,{...prepared,payloads:pair}).termsHash).not.toBe(build(binding,{...prepared,payloads:[...pair].reverse()}).termsHash);
  expect(()=>build(binding,prepared,{...evidence,maximumDebit:"901"})).toThrow();
  expect(()=>buildReviewTerms(binding,prepared,evidence,calculation,new Date("2026-11-25T12:00:20.000Z"))).toThrow();
});
test.each([
  {status:"complete",payloads:[]}, {venue:"cefi"}, {payloads:[]}, {payloads:[{payload:"changed",digest:"0".repeat(64)}]},
  {payloads:[payload("\ud800")]}, {unexpected:"schema drift"}, {quote:{...response().quote,fee_asset:"SAMPLE"}},
])("unsafe or malformed preparation remains an incident: %j",fields=>{
  expect(normalizePreparationResponse({...response(),...fields},quoteContext)).toMatchObject({kind:"incident"});
});
test("empty-ID quote-only refusal cannot become a review",()=>{
  expect(normalizePreparationResponse({...response(),order_id:"",payloads:[],quote:{...response().quote,issues:["Insufficient balance"]}},quoteContext)).toEqual({kind:"rejected",reason:"quote_only",providerOrderId:null});
});
test("a quote-only response may omit unsigned payloads",()=>{
  const raw={...response(),order_id:"",payloads:undefined,quote:{...response().quote,issues:["Insufficient balance"]}};
  expect(normalizePreparationResponse(raw,quoteContext)).toEqual({kind:"rejected",reason:"quote_only",providerOrderId:null});
});
test("malformed provider identifiers cannot enter incident metadata",()=>{
  expect(normalizePreparationResponse({...response(),order_id:"untrusted\n",status:"complete"},quoteContext)).toEqual({kind:"incident",reason:"unexpected_execution",providerOrderId:null});
});
test("payload encryption binds exact bytes to account, intent, generation and terms",()=>{
  const key=Buffer.alloc(32,7), vault=createReviewVault(key,1), hash="a".repeat(64), texts=[payload(),payload("second\n")], sealed=vault.seal(binding,hash,texts);
  key.fill(0);
  expect(vault.open(binding,hash,sealed)).toEqual(texts);
  expect(sealed.ciphertext.includes(Buffer.from("unsigned-only"))).toBe(false);
  for(const changed of [{...binding,generation:2},{...binding,accountId:binding.intentId},{...binding,intentId:binding.accountId}])expect(()=>vault.open(changed,hash,sealed)).toThrow();
  expect(()=>vault.open(binding,"b".repeat(64),sealed)).toThrow();
  const corrupt=Buffer.from(sealed.ciphertext);corrupt[0]^=1;expect(()=>vault.open(binding,hash,{...sealed,ciphertext:corrupt})).toThrow();
});
