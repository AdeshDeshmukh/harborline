import {expect,test} from "vitest";
import {buildDisposalReview,revalidateDisposalReview,assertSameDisposalTerms} from "../src/features/orders/disposal-review";
import {DisposalError} from "../src/features/orders/disposal-types";
import {binding,request,holding,quote,at} from "./fixtures/disposal";
function build(){return buildDisposalReview(binding,request,holding,quote,at());}
test("a fixture sale depends on base holdings, not buying allowance or current cash",()=>{
 const r=build();expect(r).toMatchObject({requestedBase:"0.5",expectedNetQuote:"99.5",canApprove:false,canExecute:false});expect(r).not.toHaveProperty("debitBudget");expect(r).not.toHaveProperty("calculationId");
});
test("available units already exclude holds and must not be reduced twice",()=>{
 expect(buildDisposalReview(binding,request,{...holding,available:"0.5",held:"0.5",total:"1"},quote,at()).requestedBase).toBe("0.5");
});
test.each(["0","-1","1e-1",0.5,"0.500000001","2","0.5\n"])("invalid or oversized base request fails: %s",baseQuantity=>{
 expect(()=>buildDisposalReview(binding,{...request,baseQuantity},holding,quote,at())).toThrow(DisposalError);
});
test.each([{ownerId:binding.accountId},{accountId:binding.ownerId},{providerUserId:binding.intentId}])("holding ownership mismatch is rejected: %j",change=>{
 expect(()=>buildDisposalReview(binding,request,{...holding,binding:{...binding,...change}},quote,at())).toThrow(DisposalError);
});
test.each([{source:"provider"},{assetId:binding.cashId},{address:quote.providerOrderId},{chain:"base"},{venue:"cefi"},{decimals:6},{available:"1",held:"1",total:"1"},{observedAt:at(-15001).toISOString()},{observedAt:at(1).toISOString()}])("holding identity/provenance/freshness fails closed: %j",change=>{
 expect(()=>buildDisposalReview(binding,request,{...holding,...change},quote,at())).toThrow(DisposalError);
});
test.each([{source:"provider"},{side:"buy"},{qtyUnit:"quote"},{requestedBase:"0.6"},{maximumBaseDebit:"0.6"},{feeAssetId:binding.assetId},{feeTreatment:"added_to_input"},{quotedFeeQuote:"101"},{maximumFeeQuote:"0.4"},{minimumNetQuote:"100"},{minimumNetQuote:"0"},{expectedGrossQuote:"100.0000001"},{expiresAt:at().toISOString()},{expiresAt:at(20001).toISOString()},{observedAt:at(-15001).toISOString()},{payloadDigests:[]},{payloadDigests:["payload text"]},{payloadDigests:Array(9).fill("a".repeat(64))}])("invalid sale terms are rejected: %j",change=>{
 expect(()=>buildDisposalReview(binding,request,holding,{...quote,...change},at())).toThrow(DisposalError);
});
test("unknown selectors/private metadata are rejected instead of becoming trusted terms",()=>{
 for(const requestValue of [{...request,ownerId:binding.ownerId},{...request,buyAllowance:"0"}])expect(()=>buildDisposalReview(binding,requestValue,holding,quote,at())).toThrow(DisposalError);
 expect(()=>buildDisposalReview(binding,request,holding,{...quote,payloads:["private"]},at())).toThrow(DisposalError);
});
test("revalidation checks current time and fresh unchanged holdings, not old observation age alone",()=>{
 const r=build(),fresh={...holding,observedAt:at(10000).toISOString()};
 expect(revalidateDisposalReview(r,binding,fresh,at(16000))).toEqual(r);
 for(const h of [{...fresh,available:"0.4",total:"0.4"},{...fresh,observedAt:at(-1).toISOString()},holding])expect(()=>revalidateDisposalReview(r,binding,h,at(16000))).toThrow(DisposalError);
 expect(()=>revalidateDisposalReview(r,binding,{...fresh,observedAt:at(20000).toISOString()},at(20000))).toThrow(DisposalError);
});
test("changed server binding or stored derived fields invalidate the candidate",()=>{
 const r=build();expect(()=>revalidateDisposalReview(r,{...binding,generation:2},holding,at())).toThrow(DisposalError);
 expect(()=>revalidateDisposalReview({...r,expectedNetQuote:"1000"},binding,holding,at())).toThrow(DisposalError);
});
test("exact economic equality tolerates object order but rejects changed fees, holdings and selectors",()=>{
 const r=build();expect(()=>assertSameDisposalTerms(r,JSON.parse(JSON.stringify(r)))).not.toThrow();
 for(const changed of [{...r,quote:{...r.quote,minimumNetQuote:"97"}},{...r,holding:{...r.holding,available:"2",total:"2"}},{...r,private_key:"marker"}])expect(()=>assertSameDisposalTerms(r,changed)).toThrow(DisposalError);
});
test("invalid clock and corrupt serialized terms have bounded errors",()=>{
 expect(()=>buildDisposalReview(binding,request,holding,quote,new Date(NaN))).toThrow("Sell-back evidence could not be verified");
 expect(()=>revalidateDisposalReview({private_key:"marker"},binding,holding,at())).toThrow(DisposalError);
});
test.each(["ownerId","accountId","providerUserId","intentId","assetId","cashId"])("identifier %s cannot accept a trailing newline",field=>{
 expect(()=>buildDisposalReview({...binding,[field]:binding[field as keyof typeof binding]+"\n"},request,holding,quote,at())).toThrow(DisposalError);
});
test.each([{providerOrderId:"order\n"},{contractRef:"fixture:sale\n"},{payloadDigests:["a".repeat(64)+"\n"]}])("portable quote identifiers/digests require a complete match: %j",change=>{
 expect(()=>buildDisposalReview(binding,request,holding,{...quote,...change},at())).toThrow(DisposalError);
});
test("an asset address with an extra character cannot enter the bound route",()=>{
 const b={...binding,assetAddress:binding.assetAddress+"\n"};
 expect(()=>buildDisposalReview(b,request,{...holding,binding:b,address:b.assetAddress},{...quote,binding:b},at())).toThrow(DisposalError);
});
test("a sparse digest collection cannot masquerade as a validated payload reference",()=>{
 expect(()=>buildDisposalReview(binding,request,holding,{...quote,payloadDigests:new Array(1)},at())).toThrow(DisposalError);
});
test("later validation cannot reuse an observation made before review creation",()=>{
 const r=buildDisposalReview(binding,request,holding,quote,at(10000));
 expect(()=>revalidateDisposalReview(r,binding,holding,at(14000))).toThrow(DisposalError);
 expect(revalidateDisposalReview(r,binding,{...holding,observedAt:at(10000).toISOString()},at(14000))).toEqual(r);
});
test.each([
 [0,"18446744073709551615","18446744073709551616"],
 [6,"18446744073709.551615","18446744073709.551616"],
 [8,"184467440737.09551615","184467440737.09551616"],
 [18,"18.446744073709551615","18.446744073709551616"],
] as const)("base precision %i accepts uint64 maximum and rejects its next atomic unit",(baseDecimals,maximum,above)=>{
 const b={...binding,baseDecimals},h={...holding,binding:b,decimals:baseDecimals,available:maximum,total:maximum},q={...quote,binding:b,requestedBase:maximum,maximumBaseDebit:maximum};
 expect(buildDisposalReview(b,{...request,baseQuantity:maximum},h,q,at()).requestedBase).toBe(maximum);
 expect(()=>buildDisposalReview(b,{...request,baseQuantity:above},{...h,available:above,total:above},{...q,requestedBase:above,maximumBaseDebit:above},at())).toThrow(DisposalError);
});
test("quote token amounts also respect their six-decimal atomic ceiling",()=>{
 expect(()=>buildDisposalReview(binding,request,holding,{...quote,expectedGrossQuote:"18446744073709.551616"},at())).toThrow(DisposalError);
});
