import type {OrderRecord} from "./activity-types";
import {ActivityError} from "./activity-types";
import {providerOrderStatuses,type ProviderOrderStatus} from "./recovery-types";
import {parseAmount,compareAmounts} from "../planning/money";
export function projectActualEvidence(value:unknown,recordedAt:string):NonNullable<OrderRecord["actual"]>{
 try{
  if(!value||typeof value!=="object"||Array.isArray(value)||new Date(recordedAt).toISOString()!==recordedAt)throw new Error();
  const r=value as Record<string,unknown>;
  if(!providerOrderStatuses.includes(r.providerStatus as ProviderOrderStatus))throw new Error();
  const amount=(field:string)=>r[field]===null||r[field]===undefined?null:parseAmount(r[field]);
  const providerStatus=r.providerStatus as ProviderOrderStatus,filledBase=amount("filledBase"),remainingBase=amount("remainingBase"),averagePriceQuote=amount("averagePriceQuote"),feeQuote=amount("feeQuote");
  if(providerStatus==="complete"&&(filledBase==="0"||remainingBase!==null&&remainingBase!=="0")||filledBase==="0"&&feeQuote!==null&&feeQuote!=="0"||providerStatus==="initialized"&&(filledBase!==null&&filledBase!=="0"||feeQuote!==null&&feeQuote!=="0"))throw new Error();
  const partial=filledBase===null||remainingBase===null?null:compareAmounts(filledBase,parseAmount("0"))>0&&compareAmounts(remainingBase,parseAmount("0"))>0;
  return Object.freeze({providerStatus,filledBase,remainingBase,averagePriceQuote,feeQuote,partial,recordedAt});
 }catch{throw new ActivityError("unavailable");}
}
