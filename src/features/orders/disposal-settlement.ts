import Decimal from "decimal.js";
import {addAmounts,compareAmounts,parseAmount,subtractAmounts} from "../planning/money";
import type {DisposalActual,DisposalBinding,DisposalProof,DisposalReconciliation,DisposalReview} from "./disposal-types";
import {normalizeDisposalReview} from "./disposal-review";
import {bounded,fail,fixture,fresh,instant,matchBinding,normalizeDisposalBalance,orderId,quantity,record,time,tokenQuantity} from "./disposal-validation";
const Exact=Decimal.clone({precision:80,rounding:Decimal.ROUND_DOWN,minE:-1000,maxE:1000});

function normalizeActual(value:unknown,binding:DisposalBinding):DisposalActual {
  const r=record(value,["source","binding","providerOrderId","status","filledBase","remainingBase","grossQuote","feeQuote","averagePriceQuote","observedAt"]);
  fixture(r.source);matchBinding(r.binding,binding);
  if(!["complete","failed","canceled"].includes(r.status as string))fail("unverified");
  for(const field of ["filledBase","remainingBase","grossQuote","feeQuote"]){if(r[field]===null||r[field]===undefined)fail("unverified");}
  return Object.freeze({source:"contract_fixture",binding,providerOrderId:orderId(r.providerOrderId),status:r.status as DisposalActual["status"],filledBase:tokenQuantity(r.filledBase,binding.baseDecimals),remainingBase:tokenQuantity(r.remainingBase,binding.baseDecimals),grossQuote:tokenQuantity(r.grossQuote,6),feeQuote:tokenQuantity(r.feeQuote,6),averagePriceQuote:r.averagePriceQuote===null?null:quantity(r.averagePriceQuote,18),observedAt:instant(r.observedAt)});
}
function normalizeProof(value:unknown,binding:DisposalBinding):DisposalProof {
  const r=record(value,["source","binding","providerOrderId","cashBefore","cashAfter","stockAfter","otherBaseCredits","otherBaseDebits","otherQuoteCredits","otherQuoteDebits"]);
  fixture(r.source);matchBinding(r.binding,binding);
  return Object.freeze({source:"contract_fixture",binding,providerOrderId:orderId(r.providerOrderId),cashBefore:normalizeDisposalBalance(r.cashBefore,binding,"cash"),cashAfter:normalizeDisposalBalance(r.cashAfter,binding,"cash"),stockAfter:normalizeDisposalBalance(r.stockAfter,binding,"stock"),otherBaseCredits:quantity(r.otherBaseCredits,binding.baseDecimals),otherBaseDebits:quantity(r.otherBaseDebits,binding.baseDecimals),otherQuoteCredits:quantity(r.otherQuoteCredits,6),otherQuoteDebits:quantity(r.otherQuoteDebits,6)});
}
function economics(review:DisposalReview,actual:DisposalActual) {
  // Required actuals were checked independently; no quote field can fill a gap.
  const filled=parseAmount(actual.filledBase!),remaining=parseAmount(actual.remainingBase!),gross=parseAmount(actual.grossQuote!),fee=parseAmount(actual.feeQuote!);
  const requested=parseAmount(review.requestedBase);
  if(compareAmounts(filled,requested)>0||addAmounts([filled,remaining])!==requested||compareAmounts(fee,parseAmount(review.quote.maximumFeeQuote))>0)fail("conflict");
  if(actual.status==="complete"&&(filled!==requested||remaining!=="0"))fail("conflict");
  if(filled==="0"&&(gross!=="0"||fee!=="0")||filled!=="0"&&gross==="0")fail("conflict");
  if(actual.averagePriceQuote!==null){
    const computed=quantity(new Exact(filled).times(actual.averagePriceQuote).toFixed(),6);
    if(computed!==gross)fail("conflict");
  }
  const net=subtractAmounts(gross,fee);
  if(filled===requested&&compareAmounts(net,parseAmount(review.quote.minimumNetQuote))<0)fail("conflict");
  return {filled,remaining,gross,fee,net};
}
/** Fixture mathematics only: no authentication, finality proof or reservation release. */
export function reconcileDisposalFixture(reviewValue:unknown,observationValue:unknown,proofValue:unknown,now:Date):DisposalReconciliation {
  return bounded(()=>{
    const review=normalizeDisposalReview(reviewValue),binding=review.binding,actual=normalizeActual(observationValue,binding),proof=normalizeProof(proofValue,binding),at=time(now);
    if(actual.providerOrderId!==review.quote.providerOrderId||proof.providerOrderId!==actual.providerOrderId)fail();
    const created=Date.parse(review.createdAt),observed=Date.parse(actual.observedAt);
    if(created>observed||observed>at)fail("stale_evidence");
    fresh(proof.cashBefore.observedAt,created);
    for(const balance of [proof.cashAfter,proof.stockAfter]){
      if(Date.parse(balance.observedAt)<observed)fail("stale_evidence");
      fresh(balance.observedAt,at);
    }
    if(proof.cashBefore.held!=="0"||proof.cashAfter.held!=="0"||proof.stockAfter.held!=="0")fail("unverified");
    const {filled,remaining,gross,fee,net}=economics(review,actual);
    const stockAfter=subtractAmounts(addAmounts([parseAmount(review.holding.total),parseAmount(proof.otherBaseCredits)]),addAmounts([filled,parseAmount(proof.otherBaseDebits)]));
    const cashAfter=subtractAmounts(addAmounts([parseAmount(proof.cashBefore.available),net,parseAmount(proof.otherQuoteCredits)]),parseAmount(proof.otherQuoteDebits));
    if(stockAfter!==proof.stockAfter.total||cashAfter!==proof.cashAfter.available)fail("conflict");
    return Object.freeze({kind:"reconciled_fixture",source:"contract_fixture",status:actual.status,partial:filled!=="0"&&remaining!=="0",actualBaseDebit:filled,remainingBase:remaining,actualGrossQuote:gross,actualFeeQuote:fee,actualNetQuoteCredit:net,stockTotalBefore:review.holding.total,stockTotalAfter:stockAfter,cashBefore:proof.cashBefore.available,cashAfter,otherBaseCredits:proof.otherBaseCredits,otherBaseDebits:proof.otherBaseDebits,otherQuoteCredits:proof.otherQuoteCredits,otherQuoteDebits:proof.otherQuoteDebits,recordedAt:now.toISOString(),canRelease:false,canExecute:false});
  });
}
