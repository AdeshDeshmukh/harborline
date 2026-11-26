import Decimal from "decimal.js";
import type {DisposalBinding} from "./disposal-types";
import type {SaleOrderEvidence} from "./disposal-store-types";
import {providerOrderStatuses,type ProviderOrderStatus} from "./recovery-types";
import {addAmounts,compareAmounts,parseAmount} from "../planning/money";
import {bounded,fail,normalizeDisposalBinding,orderId,quantity,tokenQuantity,uuid} from "./disposal-validation";
const Exact=Decimal.clone({precision:80,rounding:Decimal.ROUND_DOWN,minE:-1000,maxE:1000});
/** Fixture response interpretation only; provider fee/rounding conventions remain unverified. */
export function normalizeDisposalOrder(value:unknown,bindingValue:DisposalBinding,providerOrderId:string,requestedValue:string):SaleOrderEvidence {
 return bounded(()=>{
  const binding=normalizeDisposalBinding(bindingValue),requestedBase=tokenQuantity(requestedValue,binding.baseDecimals,true);
  if(!value||typeof value!=="object"||Array.isArray(value))fail();const r=value as Record<string,unknown>;
  if(orderId(r.order_id)!==orderId(providerOrderId)||uuid(r.asset_id)!==binding.assetId||r.side!=="sell"||r.qty_unit!=="base"||r.type!=="market"||r.chain!=="solana"||r.venue!=="defi"||r.quote_asset!=="USDC"||uuid(r.fee_asset)!==binding.cashId||tokenQuantity(r.qty,binding.baseDecimals,true)!==requestedBase||r.asset_type!==undefined&&r.asset_type!=="spot"||!providerOrderStatuses.includes(r.status as ProviderOrderStatus))fail();
  const amount=(field:string,decimals:number)=>r[field]===null||r[field]===undefined?null:tokenQuantity(r[field],decimals);
  const providerStatus=r.status as ProviderOrderStatus,filledBase=amount("executed_qty",binding.baseDecimals),remainingBase=amount("leaves_qty",binding.baseDecimals),feeQuote=amount("fee",6);
  let averagePriceQuote=r.executed_vwap===null||r.executed_vwap===undefined?null:quantity(r.executed_vwap,18),grossQuote:string|null=null;
  if(filledBase!==null&&compareAmounts(parseAmount(filledBase),parseAmount(requestedBase))>0||filledBase!==null&&remainingBase!==null&&addAmounts([parseAmount(filledBase),parseAmount(remainingBase)])!==requestedBase)fail();
  if(providerStatus==="complete"&&(filledBase!==null&&filledBase!==requestedBase||remainingBase!==null&&remainingBase!=="0"))fail();
  if(filledBase==="0"){
   if(feeQuote!==null&&feeQuote!=="0"||providerStatus==="complete")fail();averagePriceQuote=null;grossQuote="0";
  }else if(filledBase!==null&&averagePriceQuote!==null){
   if(averagePriceQuote==="0")fail();grossQuote=tokenQuantity(new Exact(filledBase).times(averagePriceQuote).toFixed(),6,true);
  }
  if(grossQuote!==null&&feeQuote!==null&&compareAmounts(parseAmount(feeQuote),parseAmount(grossQuote))>0)fail();
  if(providerStatus==="initialized"&&(filledBase!==null&&filledBase!=="0"||feeQuote!==null&&feeQuote!=="0"))fail();
  const partial=filledBase===null||remainingBase===null?null:filledBase!=="0"&&remainingBase!=="0";
  return Object.freeze({providerStatus,filledBase,remainingBase,averagePriceQuote,feeQuote,grossQuote,partial});
 });
}
