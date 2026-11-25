import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createGatewayReadAdapter } from "../src/integrations/truemarkets/reads.server";
import { createMarketReadService } from "../src/features/market-data/service.server";
import { SOLANA_USDC_MINT } from "../src/integrations/truemarkets/read-types";
import type { OwnerContext } from "../src/features/identity/access.server";
const stockId="11111111-1111-4111-8111-111111111111", cashId="22222222-2222-4222-8222-222222222222", providerUserId="33333333-3333-4333-8333-333333333333";
const context={ ownerId:"44444444-4444-4444-8444-444444444444", accountId:"55555555-5555-4555-8555-555555555555", externalRefId:"fixture" } as OwnerContext;
const instant=new Date("2026-11-25T12:00:00Z");
const route={ stockId, cashId, stockAddress:"11111111111111111111111111111111" };
function setup(options: { wrongOwner?:boolean; restricted?:boolean; proofSource?:string; stale?:boolean; noGuidance?:boolean; wrongCountry?:boolean; pending?:boolean; future?:boolean; expired?:boolean; noApproval?:boolean; wrongQuote?:boolean; notReady?:boolean; restrictedCustomer?:boolean; emptyAllowlist?:boolean; delayMs?:number; metadataDelayMs?:number; planningDelayMs?:number; proofTtlMs?:number; late?:boolean; countryCode?:string; backendCode?:string }={}) {
  const calls: Array<{method:string;path:string;userId?:string}>=[];
  const stock={ id:stockId, address:route.stockAddress, symbol:"SAMPLE", name:"Sample stock", decimals:6,chain:"solana",venue:"defi",type:"spot",asset_class:"stock",stable:false,status:"active",tradeable:true,networks:[],order_types:["market"] };
  const cash={ ...stock,id:cashId,address:SOLANA_USDC_MINT,symbol:"USDC",asset_class:"crypto",stable:true,tradeable:false,order_types:[] };
  const initial=options.late?new Date("2026-11-25T23:59:59Z"):instant;
  let clock=initial.getTime();
  const adapter=createGatewayReadAdapter({request:async (method,path,opts) => {
    calls.push({method,path,userId:opts?.userId});
    if(path.includes("/assets/solana/")) return path.endsWith(SOLANA_USDC_MINT)?cash:stock;
    if(path.endsWith("/restrictions")) return {data:[{asset_class:"stock",countries:options.restricted?[{code:"DE",name:"Fixture country"}]:options.restrictedCustomer?[{code:"US",name:"Fixture country"}]:[]}]};
    if(path.endsWith("/availability")) { clock += options.metadataDelayMs??0; return {country:options.wrongCountry?"US":"DE",allowed_product_types:["spot"],allowed_asset_classes:options.emptyAllowlist?[]:["stock"]}; }
    if(path.endsWith("/balances")) { clock+=options.stale?15001:options.delayMs??0; return {data:[{asset_id:cashId,address:SOLANA_USDC_MINT,symbol:"USDC",chain:"solana",venue:"defi",decimals:6,stable:true,tradeable:false,available:"1500",held:"100",total:"1600",allocated:"50"}]}; }
    throw new Error("unexpected fixture request");
  }},"contract_fixture",()=>new Date(clock+(options.future?1:0)));
  const account={ownerId:options.wrongOwner?"66666666-6666-4666-8666-666666666666":context.ownerId,accountId:context.accountId,externalRefId:context.externalRefId,providerUserId,provisioningState:options.notReady?"PROVISIONING":"READY",pilotEnabled:true,eligibilityStatus:"ELIGIBLE" as const,eligibilityCheckedAt:initial.toISOString(),activeOperationId:options.pending?stockId:null,solanaAddress:route.stockAddress,timezone:"UTC"};
  const proof={source:options.proofSource??"contract_fixture",ownerId:context.ownerId,accountId:context.accountId,providerUserId,country:options.countryCode??(options.restrictedCustomer?"US":"DE"),backendCountry:options.backendCode??"DE",guidanceRef:options.noGuidance?"":"fixture-guidance-not-live",backendMethodRef:"fixture-method",stockId,quoteAssetId:options.wrongQuote?stockId:cashId,checkedAt:initial.toISOString(),expiresAt:new Date(initial.getTime()+(options.expired?0:options.proofTtlMs??60000)).toISOString(),endUserApproved:!options.noApproval,backendMethodVerified:true,quoteAssetVerified:true,recoveryAndExitVerified:false};
  const service=createMarketReadService({route,adapter,account:async()=>account,eligibility:async()=>proof,planning:async()=>{ clock += options.planningDelayMs??0; return ({revision:2,policy:{revision:2,horizonDays:30,additionalBuffer:"100",acknowledgedAt:instant.toISOString()},commitments:[{id:"rent",label:"Rent",amount:"1200",dueDate:options.late?"2026-12-26":"2026-12-01",status:"outstanding",revision:1}]});},clock:()=>new Date(clock)});
  return {service,calls};
}
test("adapter uses GET only and binds private reads to the server-resolved provider customer",async()=>{
  const {service,calls}=setup(); const result=await service.balance(context);
  expect(result).toMatchObject({source:"contract_fixture",canAuthorize:false,balance:{available:"1500",held:"100",allocated:"50"},funding:null});
  expect(calls.filter(call=>call.path.endsWith("/balances"))).toEqual([{method:"GET",path:"/v1/gateway/balances",userId:providerUserId}]);
  expect(calls.filter(call=>!call.path.endsWith("/balances")).every(call=>call.method==="GET"&&call.userId===undefined)).toBe(true);
});
test.each([{wrongOwner:true},{noGuidance:true},{proofSource:"provider_guidance"},{pending:true},{expired:true},{noApproval:true},{wrongQuote:true},{notReady:true}])("unverified ownership/access blocks private calls: %j",async options=>{
  const {service,calls}=setup(options); await expect(service.balance(context)).rejects.toThrow();
  expect(calls).toEqual([]);
});
test.each([{restricted:true},{wrongCountry:true},{restrictedCustomer:true},{emptyAllowlist:true}])("restriction and backend-country mismatch block before private balance access: %j",async options=>{
  const {service,calls}=setup(options); await expect(service.balance(context)).rejects.toThrow();
  expect(calls.some(call=>call.path.endsWith("/balances"))).toBe(false);
});
test.each([{stale:true},{future:true}])("slow or future-dated evidence cannot gain freshness from completion: %j",async options=>{
  const {service}=setup(options); await expect(service.balance(context)).rejects.toMatchObject({code:"stale_evidence"});
});
test("normalized available feeds the existing exact allowance formula without deducting holds again",async()=>{
  const {service}=setup();
  const result=await service.allowance(context);
  expect(result).toMatchObject({source:"contract_fixture",canAuthorize:false,calculation:{commitmentsTotal:"1200",additionalBuffer:"100",debitBudget:"200",shortfall:"0"}});
});

test("exactly fifteen seconds remains within the bounded read freshness window",async()=>{const {service}=setup({delayMs:15000});expect(await service.balance(context)).toMatchObject({balance:{available:"1500"},canAuthorize:false});});

test("a slow plan lookup cannot outlive metadata or eligibility evidence",async()=>{
 await expect(setup({metadataDelayMs:10000,planningDelayMs:6000}).service.allowance(context)).rejects.toMatchObject({code:"stale_evidence"});
 await expect(setup({proofTtlMs:1000,planningDelayMs:1001}).service.allowance(context)).rejects.toMatchObject({code:"eligibility_unverified"});
});
test("the calculation date is resolved after a plan lookup crossing local midnight",async()=>{
 expect(await setup({late:true,planningDelayMs:2000}).service.allowance(context)).toMatchObject({asOfLocalDate:"2026-11-26",calculation:{commitmentsTotal:"1200",debitBudget:"200"}});
});
test.each([{countryCode:"AA"},{backendCode:"AA"}])("unassigned country evidence cannot trigger provider reads: %j",async options=>{
 const {service,calls}=setup(options);await expect(service.balance(context)).rejects.toMatchObject({code:"eligibility_unverified"});expect(calls).toEqual([]);
});
