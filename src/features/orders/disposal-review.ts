import {compareAmounts,parseAmount,subtractAmounts} from "../planning/money";
import {DisposalError,type DisposalBinding,type DisposalQuote,type DisposalReview} from "./disposal-types";
import {bounded,fail,fixture,fresh,instant,matchBinding,normalizeDisposalBalance,normalizeDisposalBinding,orderId,quantity,record,time,tokenQuantity,uuid} from "./disposal-validation";

function normalizeQuote(value:unknown,binding:DisposalBinding,requestedBase:string,now:number):DisposalQuote {
  const r=record(value,["source","binding","contractRef","providerOrderId","side","qtyUnit","requestedBase","maximumBaseDebit","expectedGrossQuote","quotedFeeQuote","maximumFeeQuote","minimumNetQuote","feeAssetId","feeTreatment","observedAt","expiresAt","payloadDigests"]);
  fixture(r.source);matchBinding(r.binding,binding);
  if(r.side!=="sell"||r.qtyUnit!=="base"||r.feeTreatment!=="deducted_from_proceeds"||uuid(r.feeAssetId)!==binding.cashId||typeof r.contractRef!=="string"||!/^fixture:[A-Za-z0-9_-]{1,128}$/.test(r.contractRef))fail();
  const quotedBase=tokenQuantity(r.requestedBase,binding.baseDecimals,true),maximumBaseDebit=tokenQuantity(r.maximumBaseDebit,binding.baseDecimals,true);
  if(quotedBase!==requestedBase||maximumBaseDebit!==requestedBase)fail();
  const expectedGrossQuote=tokenQuantity(r.expectedGrossQuote,6,true),quotedFeeQuote=tokenQuantity(r.quotedFeeQuote,6),maximumFeeQuote=tokenQuantity(r.maximumFeeQuote,6),minimumNetQuote=tokenQuantity(r.minimumNetQuote,6,true);
  const net=subtractAmounts(parseAmount(expectedGrossQuote),parseAmount(quotedFeeQuote));
  if(compareAmounts(parseAmount(maximumFeeQuote),parseAmount(quotedFeeQuote))<0||compareAmounts(parseAmount(maximumFeeQuote),parseAmount(expectedGrossQuote))>0||compareAmounts(parseAmount(minimumNetQuote),net)>0)fail();
  const observedAt=instant(r.observedAt),expiresAt=instant(r.expiresAt),expires=Date.parse(expiresAt),observed=Date.parse(observedAt);
  fresh(observedAt,now);if(expires<=now||expires<=observed||expires-observed>20000)fail("stale_evidence");
  if(!Array.isArray(r.payloadDigests)||r.payloadDigests.length<1||r.payloadDigests.length>8||Array.from(r.payloadDigests).some(d=>typeof d!=="string"||!/^[0-9a-f]{64}$/.test(d)))fail();
  return Object.freeze({source:"contract_fixture",binding,contractRef:r.contractRef as string,providerOrderId:orderId(r.providerOrderId),side:"sell",qtyUnit:"base",requestedBase,maximumBaseDebit,expectedGrossQuote,quotedFeeQuote,maximumFeeQuote,minimumNetQuote,feeAssetId:binding.cashId,feeTreatment:"deducted_from_proceeds",observedAt,expiresAt,payloadDigests:Object.freeze([...(r.payloadDigests as string[])])});
}
/** Computes a fixture review. It grants no identity, operator or execution authority. */
export function buildDisposalReview(bindingValue:unknown,request:unknown,holdingValue:unknown,quoteValue:unknown,now:Date):DisposalReview {
  return bounded(()=>{
    const binding=normalizeDisposalBinding(bindingValue),at=time(now);
    let requestedBase:string;
    try {const r=record(request,["assetId","baseQuantity"]);if(uuid(r.assetId)!==binding.assetId)fail();requestedBase=tokenQuantity(r.baseQuantity,binding.baseDecimals,true);}
    catch {throw new DisposalError("invalid_request");}
    const holding=normalizeDisposalBalance(holdingValue,binding,"stock");fresh(holding.observedAt,at);
    if(compareAmounts(parseAmount(requestedBase),parseAmount(holding.available))>0)fail("invalid_request");
    const quote=normalizeQuote(quoteValue,binding,requestedBase,at),expectedNetQuote=subtractAmounts(parseAmount(quote.expectedGrossQuote),parseAmount(quote.quotedFeeQuote));
    return Object.freeze({kind:"disposal_fixture",version:1,source:"contract_fixture",binding,requestedBase,holding,quote,expectedNetQuote,createdAt:now.toISOString(),canApprove:false,canExecute:false});
  });
}
/** Revalidate serialized terms before comparing them; TypeScript types are not validation. */
export function normalizeDisposalReview(value:unknown):DisposalReview {
  return bounded(()=>{
    const r=record(value,["kind","version","source","binding","requestedBase","holding","quote","expectedNetQuote","createdAt","canApprove","canExecute"]);
    if(r.kind!=="disposal_fixture"||r.version!==1||r.canApprove!==false||r.canExecute!==false)fail();fixture(r.source);
    const binding=normalizeDisposalBinding(r.binding),createdAt=instant(r.createdAt);
    const result=buildDisposalReview(binding,{assetId:binding.assetId,baseQuantity:r.requestedBase},r.holding,r.quote,new Date(createdAt));
    if(quantity(r.expectedNetQuote,6)!==result.expectedNetQuote)fail();
    return result;
  });
}
export function revalidateDisposalReview(value:unknown,currentBinding:unknown,freshHolding:unknown,now:Date):DisposalReview {
  return bounded(()=>{
    const review=normalizeDisposalReview(value),binding=normalizeDisposalBinding(currentBinding);matchBinding(review.binding,binding);
    const at=time(now);if(at<Date.parse(review.createdAt)||at>=Date.parse(review.quote.expiresAt))fail("stale_evidence");
    const holding=normalizeDisposalBalance(freshHolding,binding,"stock");fresh(holding.observedAt,at);
    if(Date.parse(holding.observedAt)<Date.parse(review.createdAt))fail("stale_evidence");
    if(holding.available!==review.holding.available||holding.held!==review.holding.held||holding.total!==review.holding.total)fail("conflict");
    return review;
  });
}
export function assertSameDisposalTerms(expected:unknown,presented:unknown):void {
  bounded(()=>{if(JSON.stringify(normalizeDisposalReview(expected))!==JSON.stringify(normalizeDisposalReview(presented)))fail("conflict");});
}
