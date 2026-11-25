import "server-only";
import { createHash } from "node:crypto";
import { normalizePreparationResponse } from "../../integrations/truemarkets/preparation.server";
import { SOLANA_USDC_MINT, type SupportedAssets } from "../../integrations/truemarkets/read-types";
import { calculateAllowance } from "../planning/calculate-allowance";
import { buildReviewTerms } from "./review-terms.server";
import { projectReviewScreen } from "./review-screen";
import type { ReviewScreen } from "./screen-types";
export type SampleReviewScenario="current"|"expired"|"changed"|"unavailable";
export function createSampleReviewScreen(scenario:SampleReviewScenario="current",now:Date=new Date()):ReviewScreen {
  // A fictional server response for UI inspection, not a database record,
  // provider quote, account, or claim of live integration.
  const stock={id:"11111111-1111-4111-8111-111111111111",address:"11111111111111111111111111111111",symbol:"HBRX",name:"Harborline Example Equity",decimals:6,chain:"solana",venue:"defi",type:"spot",assetClass:"stock",stable:false,tradeable:true} as const;
  const assets:SupportedAssets={stock,cash:{...stock,id:"22222222-2222-4222-8222-222222222222",address:SOLANA_USDC_MINT,symbol:"USDC",name:"USDC",assetClass:"crypto",stable:true,tradeable:false}};
  const observed=new Date(now.getTime()-(scenario==="expired"?30000:5000)),expiresAt=new Date(observed.getTime()+20000).toISOString();
  const payload='{"sample":"unsigned-example-only"}\n';
  const prepared=normalizePreparationResponse({order_id:"sample_not_a_real_order",status:"initialized",venue:"defi",payloads:[{payload,digest:createHash("sha256").update(payload).digest("hex")}],quote:{base_asset:"HBRX",quote_asset:"USDC",qty:"100",qty_out:"0.5",fee:"0.5",fee_asset:"USDC",issues:[]}},
    {source:"contract_fixture",assets,observedAt:observed.toISOString(),baseIdentifier:"HBRX",quoteIdentifier:"USDC",side:"buy",qtyUnit:"quote",requestedAmount:"100"});
  if(prepared.kind!=="prepared")throw new Error("Invalid sample terms");
  const date=now.toISOString().slice(0,10),result=calculateAllowance({available:"2000",additionalBuffer:"500",asOfLocalDate:date,horizonDays:30,policyRevision:2,commitments:[{id:"sample-rent",amount:"1200",dueDate:date,status:"outstanding"}]}),binding={accountId:"33333333-3333-4333-8333-333333333333",intentId:"44444444-4444-4444-8444-444444444444",generation:1,policyRevision:2,calculationId:"55555555-5555-4555-8555-555555555555"};
  const {terms,termsHash}=buildReviewTerms(binding,prepared,{source:"contract_fixture",quoteFingerprint:prepared.quote.fingerprint,contractRef:"public-ui-illustration-only",maximumDebit:"100.5",expiresAt,feeTreatment:"added_to_input"},{available:"2000",result},observed);
  const screen=projectReviewScreen({scope:binding.accountId,intentId:binding.intentId,intentState:"REVIEW_READY",policyChanged:scenario==="changed",balanceCurrent:true,balanceValidUntil:new Date(observed.getTime()+15000).toISOString(),slotMatches:true,generationMatches:true,serverNow:now.toISOString(),review:{operationKind:"buy",feeTreatment:terms.bounds.feeTreatment,blockingReasons:["fixture_only"],intentId:binding.intentId,reviewRevision:1,termsHash,source:"contract_fixture",providerOrderId:prepared.providerOrderId,quote:terms.quote,maximumDebit:terms.bounds.maximumDebit,localExpiresAt:expiresAt,cash:terms.cash,canApprove:false,canExecute:false}},true);
  return scenario==="unavailable"?{...screen,status:"unavailable",review:null}:screen;
}
