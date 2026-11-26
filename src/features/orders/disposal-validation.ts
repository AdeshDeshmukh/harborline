import {addAmounts,parseAmount} from "../planning/money";
import {isSolanaAddress} from "../../integrations/truemarkets/solana-address";
import {SOLANA_USDC_MINT} from "../../integrations/truemarkets/read-types";
import {DisposalError,type DisposalBalance,type DisposalBinding} from "./disposal-types";

export function fail(code:DisposalError["code"]="invalid_terms"):never {throw new DisposalError(code);}
export function bounded<T>(work:()=>T):T {
  try {return work();} catch(error) {if(error instanceof DisposalError)throw error;return fail();}
}
export function record(value:unknown,keys:readonly string[]):Record<string,unknown> {
  if(!value||typeof value!=="object"||Array.isArray(value))return fail();
  const r=value as Record<string,unknown>,actual=Object.keys(r);
  if(actual.length!==keys.length||actual.some(k=>!keys.includes(k)))return fail();
  return r;
}
export function uuid(value:unknown):string {
  if(typeof value!=="string"||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))return fail();
  return value.toLowerCase();
}
export function quantity(value:unknown,scale:number,positive=false):string {
  return parseAmount(parseAmount(value),{scale,positive});
}
// SPL token balances and individual token amounts use unsigned 64-bit atoms.
// Ratios and cumulative unrelated movement totals deliberately use quantity().
export function tokenQuantity(value:unknown,scale:number,positive=false):string {
  const amount=quantity(value,scale,positive),[whole,fraction=""]=amount.split(".");
  const atoms=BigInt(whole)*BigInt(10)**BigInt(scale)+BigInt(fraction.padEnd(scale,"0")||"0");
  if(atoms>BigInt("18446744073709551615"))fail();
  return amount;
}
export function instant(value:unknown):string {
  if(typeof value!=="string"||value.length!==24||value.startsWith("0000")||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)||new Date(value).toISOString()!==value)return fail();
  return value;
}
export function time(now:Date):number {
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))return fail();
  instant(now.toISOString());return now.getTime();
}
export function fresh(at:string,now:number):void {
  const age=now-Date.parse(at);if(age<0||age>15000)fail("stale_evidence");
}
export function normalizeDisposalBinding(value:unknown):DisposalBinding {
  const r=record(value,["ownerId","accountId","providerUserId","intentId","generation","policyRevision","assetId","assetAddress","cashId","baseDecimals"]);
  for(const key of ["generation","policyRevision"]){if(!Number.isInteger(r[key])||(r[key] as number)<1||(r[key] as number)>2147483647)fail();}
  if(!Number.isInteger(r.baseDecimals)||(r.baseDecimals as number)<0||(r.baseDecimals as number)>18||typeof r.assetAddress!=="string"||!isSolanaAddress(r.assetAddress)||r.assetAddress===SOLANA_USDC_MINT)fail();
  const assetId=uuid(r.assetId),cashId=uuid(r.cashId);if(assetId===cashId)fail();
  return Object.freeze({ownerId:uuid(r.ownerId),accountId:uuid(r.accountId),providerUserId:uuid(r.providerUserId),intentId:uuid(r.intentId),generation:r.generation as number,policyRevision:r.policyRevision as number,assetId,assetAddress:r.assetAddress as string,cashId,baseDecimals:r.baseDecimals as number});
}
export function matchBinding(value:unknown,expected:DisposalBinding):DisposalBinding {
  const actual=normalizeDisposalBinding(value);
  if(actual.ownerId!==expected.ownerId||actual.accountId!==expected.accountId||actual.providerUserId!==expected.providerUserId)fail("wrong_owner");
  if(JSON.stringify(actual)!==JSON.stringify(expected))fail();
  return actual;
}
export function fixture(value:unknown):void {if(value!=="contract_fixture")fail("unverified");}
export function orderId(value:unknown):string {
  if(typeof value!=="string"||value.length<1||value.length>128||!/^[A-Za-z0-9_-]+$/.test(value))return fail();
  return value;
}
export function normalizeDisposalBalance(value:unknown,binding:DisposalBinding,kind:"stock"|"cash"):DisposalBalance {
  const r=record(value,["source","binding","assetId","address","chain","venue","decimals","available","held","total","observedAt"]);
  fixture(r.source);matchBinding(r.binding,binding);
  const decimals=kind==="stock"?binding.baseDecimals:6,assetId=kind==="stock"?binding.assetId:binding.cashId,address=kind==="stock"?binding.assetAddress:SOLANA_USDC_MINT;
  if(uuid(r.assetId)!==assetId||r.address!==address||r.chain!=="solana"||r.venue!=="defi"||r.decimals!==decimals)fail();
  const available=tokenQuantity(r.available,decimals),held=tokenQuantity(r.held,decimals),total=tokenQuantity(r.total,decimals);
  if(addAmounts([parseAmount(available),parseAmount(held)])!==total)fail();
  return Object.freeze({source:"contract_fixture",binding,assetId,address,chain:"solana",venue:"defi",decimals,available,held,total,observedAt:instant(r.observedAt)});
}
