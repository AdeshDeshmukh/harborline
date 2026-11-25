import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { normalizePricePreview, normalizeDefiQuote, assessFixtureTerms } from "../src/integrations/truemarkets/quote-contracts";
import { SOLANA_USDC_MINT, type SupportedAssets } from "../src/integrations/truemarkets/read-types";
import type { QuoteContext } from "../src/integrations/truemarkets/quote-types";
const instant="2026-11-25T12:00:00.000Z";
const stock={id:"11111111-1111-4111-8111-111111111111",address:"11111111111111111111111111111111",symbol:"SAMPLE",name:"Sample stock",decimals:6,chain:"solana",venue:"defi",type:"spot",assetClass:"stock",stable:false,tradeable:true} as const;
const assets:SupportedAssets={stock,cash:{...stock,id:"22222222-2222-4222-8222-222222222222",address:SOLANA_USDC_MINT,symbol:"USDC",name:"USDC",assetClass:"crypto",stable:true,tradeable:false}};
const context:QuoteContext={source:"contract_fixture",assets,observedAt:instant,baseIdentifier:"SAMPLE",quoteIdentifier:"USDC",side:"buy",qtyUnit:"quote",requestedAmount:"100"};
const details=()=>({base_asset:"SAMPLE",quote_asset:"USDC",qty:"100.000000",qty_out:"0.5",fee:"0.50",fee_asset:"USDC",issues:[] as string[]});
const evidence=(fingerprint:string)=>({source:"contract_fixture" as const,quoteFingerprint:fingerprint,contractRef:"fixture-only-not-provider-contract",maximumDebit:"100.5",expiresAt:"2026-11-25T12:00:30.000Z",feeTreatment:"added_to_input" as const});
test("price previews retain exact expected values and never fabricate bounds or expiry",()=>{
 const view=normalizePricePreview({qty:"0.4992",price:"200",notional:"99.84",fee:"0.039936"},context);
 expect(view).toMatchObject({kind:"nonbinding_preview",notional:"99.84",feeAmount:"0.039936",estimatedDebit:"99.879936",maximumDebit:null,expiresAt:null,canAuthorize:false});
 expect(Object.isFrozen(view)).toBe(true);
});
test.each([undefined,null,{}, {qty:"1",price:"2",notional:"2"}, {qty:"1",price:"2",notional:"2",fee:0}, {qty:"1",price:"2",notional:"2",fee:"0",max_debit:"2"}])("missing or changed preview fee schema is rejected: %j",value=>{expect(()=>normalizePricePreview(value,context)).toThrow();});
test.each(["NaN","-1","1e2","1.0000001",100," 1","01"])("malformed or unsupported quote-currency values fail: %s",value=>{expect(()=>normalizeDefiQuote({...details(),fee:value},context)).toThrow();});
test("zero fees are valid but a zero input or output is not a tradable quote",()=>{
 expect(normalizeDefiQuote({...details(),fee:"0"},context).feeAmount).toBe("0");
 for(const fields of [{qty:"0"},{qty_out:"0"}])expect(()=>normalizeDefiQuote({...details(),...fields},context)).toThrow();
});
test("raw input quantity and identifiers must match the requested supported route",()=>{
 for(const fields of [{qty:"99"},{base_asset:"OTHER"},{quote_asset:"USDT"},{fee_asset:"SAMPLE"}])expect(()=>normalizeDefiQuote({...details(),...fields},context)).toThrow();
 for(const changed of [{...assets.stock,chain:"base"},{...assets.stock,venue:"cefi"},{...assets.stock,assetClass:"crypto"}])expect(()=>normalizeDefiQuote(details(),{...context,assets:{...assets,stock:changed} as SupportedAssets})).toThrow();
});
test("quote information is immutable and its fingerprint changes with economic or route terms",()=>{
 const raw=details(),quote=normalizeDefiQuote(raw,context);raw.issues.push("changed");raw.fee="5";
 expect(quote).toMatchObject({kind:"defi_quote_information",inputAmount:"100",feeAmount:"0.5",issues:[],canAuthorize:false});
 expect(quote.fingerprint).not.toBe(normalizeDefiQuote({...details(),fee:"0.6"},context).fingerprint);
 expect(quote.fingerprint).not.toBe(normalizeDefiQuote(details(),{...context,assets:{...assets,stock:{...stock,id:"33333333-3333-4333-8333-333333333333"}}}).fingerprint);
 expect(Object.isFrozen(quote.issues)).toBe(true);
});
test("provider quote information stays blocked even when caller supplies fixture bounds",()=>{
 const quote=normalizeDefiQuote(details(),{...context,source:"provider"});
 expect(assessFixtureTerms(quote,evidence(quote.fingerprint),"300",new Date(instant))).toEqual({kind:"blocked",reason:"unverified_provider_contract",canAuthorize:false});
});
test("unverified or issue-bearing terms never become bounded fixtures",()=>{
 const quote=normalizeDefiQuote(details(),context);
 expect(assessFixtureTerms(quote,null,"300",new Date(instant))).toMatchObject({kind:"blocked",reason:"unverified_terms"});
 const warned=normalizeDefiQuote({...details(),issues:["High price impact"]},context);
 expect(assessFixtureTerms(warned,evidence(warned.fingerprint),"300",new Date(instant))).toMatchObject({kind:"blocked",reason:"quote_issues"});
});
test("an explicit fixture cap includes added fees and consumes only exact room",()=>{
 const quote=normalizeDefiQuote(details(),context),terms=evidence(quote.fingerprint);
 expect(assessFixtureTerms(quote,terms,"100.50",new Date(instant))).toEqual({kind:"bounded_fixture",source:"contract_fixture",quoteFingerprint:quote.fingerprint,maximumDebit:"100.5",validUntil:"2026-11-25T12:00:20.000Z",feeTreatment:"added_to_input",canAuthorize:false});
 expect(assessFixtureTerms(quote,terms,"100.49",new Date(instant))).toMatchObject({kind:"blocked",reason:"debit_exceeds_allowance"});
 expect(assessFixtureTerms(quote,{...terms,maximumDebit:"100"},"300",new Date(instant))).toMatchObject({kind:"blocked",reason:"inconsistent_bound"});
});
test("included-fee semantics must be explicit and cannot include a fee larger than the input",()=>{
 const quote=normalizeDefiQuote(details(),context),terms={...evidence(quote.fingerprint),feeTreatment:"included_in_input",maximumDebit:"100"};
 expect(assessFixtureTerms(quote,terms,"100",new Date(instant))).toMatchObject({kind:"bounded_fixture",maximumDebit:"100"});
 expect(assessFixtureTerms(quote,{...terms,feeTreatment:"unknown"},"300",new Date(instant))).toMatchObject({kind:"blocked",reason:"invalid_evidence"});
 const invalid=normalizeDefiQuote({...details(),fee:"101"},context);
 expect(assessFixtureTerms(invalid,{...terms,quoteFingerprint:invalid.fingerprint},"300",new Date(instant))).toMatchObject({kind:"blocked",reason:"inconsistent_bound"});
});
test("exact local freshness, expiry and future-time boundaries fail closed",()=>{
 const quote=normalizeDefiQuote(details(),context),terms=evidence(quote.fingerprint);
 expect(assessFixtureTerms(quote,terms,"300",new Date("2026-11-25T12:00:20.000Z"))).toMatchObject({kind:"blocked",reason:"stale_quote"});
 expect(assessFixtureTerms(quote,terms,"300",new Date("2026-11-25T12:00:19.999Z"))).toMatchObject({kind:"bounded_fixture"});
 expect(assessFixtureTerms(quote,terms,"300",new Date("2026-11-25T11:59:59.999Z"))).toMatchObject({kind:"blocked",reason:"stale_quote"});
 expect(assessFixtureTerms(quote,{...terms,expiresAt:instant},"300",new Date(instant))).toMatchObject({kind:"blocked",reason:"stale_quote"});
 expect(assessFixtureTerms(quote,terms,"300",new Date(NaN))).toMatchObject({kind:"blocked"});
});
test("evidence is bound to this exact quote and cannot be extended with invented terms",()=>{
 const quote=normalizeDefiQuote(details(),context),terms=evidence(quote.fingerprint);
 expect(assessFixtureTerms(quote,{...terms,quoteFingerprint:"0".repeat(64)},"300",new Date(instant))).toMatchObject({kind:"blocked",reason:"terms_mismatch"});
 for(const bad of [{...terms,source:"provider_guidance"},{...terms,contractRef:""},{...terms,expiresAt:"tomorrow"},{...terms,slippage:"0.1"}])expect(assessFixtureTerms(quote,bad,"300",new Date(instant))).toMatchObject({kind:"blocked",reason:"invalid_evidence"});
});
test("caller-selected identifier aliases cannot change the listing or fee denomination",()=>{
 expect(()=>normalizeDefiQuote({...details(),quote_asset:"USDT",fee_asset:"USDT"},{...context,quoteIdentifier:"USDT"})).toThrow();
 expect(()=>normalizeDefiQuote({...details(),base_asset:"OTHER"},{...context,baseIdentifier:"OTHER"})).toThrow();
});
test("fractional input plus added fee stays exactly within a decimal cap",()=>{
 const quote=normalizeDefiQuote({...details(),qty:"0.10",qty_out:"0.0005",fee:"0.20"},{...context,requestedAmount:"0.1"});
 expect(assessFixtureTerms(quote,{...evidence(quote.fingerprint),maximumDebit:"0.30"},"0.30",new Date(instant))).toMatchObject({kind:"bounded_fixture",maximumDebit:"0.3"});
});
test("an included fee cannot consume all input while claiming a positive swap output",()=>{
 const quote=normalizeDefiQuote({...details(),fee:"100"},context);
 expect(assessFixtureTerms(quote,{...evidence(quote.fingerprint),feeTreatment:"included_in_input",maximumDebit:"100"},"100",new Date(instant))).toMatchObject({kind:"blocked",reason:"inconsistent_bound"});
});
test("selected aliases must not identify both the stock and native cash asset",()=>{
 for(const alias of ["USDC",SOLANA_USDC_MINT,assets.cash.id]){
  const ctx={...context,assets:{...assets,stock:{...stock,symbol:alias}},baseIdentifier:alias,quoteIdentifier:alias==="USDC"?SOLANA_USDC_MINT:"USDC"};
  expect(()=>normalizeDefiQuote({...details(),base_asset:alias,quote_asset:ctx.quoteIdentifier,fee_asset:ctx.quoteIdentifier},ctx)).toThrow();
 }
});
