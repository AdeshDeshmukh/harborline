import type {DisposalReconciliation} from "./disposal-types";
import {bounded,fail,fixture,instant,quantity,tokenQuantity} from "./disposal-validation";
/** Explicit fields only, including for immutable historical results with future metadata. */
export function projectDisposalReconciliation(value:unknown,baseDecimals:number):DisposalReconciliation {
 return bounded(()=>{
  if(!value||typeof value!=="object"||Array.isArray(value))fail();const r=value as Record<string,unknown>;fixture(r.source);
  if(r.kind!=="reconciled_fixture"||!["complete","failed","canceled"].includes(r.status as string)||typeof r.partial!=="boolean"||r.canRelease!==false||r.canExecute!==false)fail();
  const base=(k:string)=>tokenQuantity(r[k],baseDecimals),cash=(k:string)=>tokenQuantity(r[k],6);
  return {kind:"reconciled_fixture",source:"contract_fixture",status:r.status as DisposalReconciliation["status"],partial:r.partial as boolean,actualBaseDebit:base("actualBaseDebit"),remainingBase:base("remainingBase"),actualGrossQuote:cash("actualGrossQuote"),actualFeeQuote:cash("actualFeeQuote"),actualNetQuoteCredit:cash("actualNetQuoteCredit"),stockTotalBefore:base("stockTotalBefore"),stockTotalAfter:base("stockTotalAfter"),cashBefore:cash("cashBefore"),cashAfter:cash("cashAfter"),otherBaseCredits:quantity(r.otherBaseCredits,baseDecimals),otherBaseDebits:quantity(r.otherBaseDebits,baseDecimals),otherQuoteCredits:quantity(r.otherQuoteCredits,6),otherQuoteDebits:quantity(r.otherQuoteDebits,6),recordedAt:instant(r.recordedAt),canRelease:false,canExecute:false};
 });
}
