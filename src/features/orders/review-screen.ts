import type { ReviewEvidence, ReviewScreen } from "./screen-types";
import { parseAmount } from "../planning/money";

export function projectReviewScreen(evidence: ReviewEvidence, sample = false): ReviewScreen {
  const screen: ReviewScreen = {scope:evidence.scope,intentId:evidence.intentId,review:evidence.review,serverNow:evidence.serverNow,balanceValidUntil:evidence.balanceValidUntil,sample,status:"unavailable",canProceed:false};
  const now=Date.parse(evidence.serverNow),review=evidence.review;
  if(!Number.isFinite(now))return {...screen,review:null};
  if(["SUBMITTING","PENDING","UNKNOWN","MANUAL_REVIEW"].includes(evidence.intentState))return {...screen,status:"uncertain"};
  if(["COMPLETE","FAILED","CANCELED","REJECTED","ABANDONED"].includes(evidence.intentState))return {...screen,status:"closed"};
  if(evidence.intentState==="EXPIRED")return {...screen,status:"expired"};
  if(!review)return {...screen,status:["DRAFT","PREPARING"].includes(evidence.intentState)?"preparing":"missing"};
  try {
    const observed=Date.parse(review.quote.observedAt),expiry=Date.parse(review.localExpiresAt);
    if(!Number.isFinite(observed)||!Number.isFinite(expiry)||now<observed||expiry<=observed||expiry>observed+20000||review.intentId!==evidence.intentId||review.source!=="contract_fixture"||review.quote.chain!=="solana"||review.quote.venue!=="defi"||review.canApprove!==false||review.canExecute!==false)throw new Error();
    for(const value of [review.quote.inputAmount,review.quote.expectedOutput,review.quote.feeAmount,review.maximumDebit,...Object.values(review.cash)])parseAmount(value);
    if(evidence.policyChanged)return {...screen,status:"changed_plan"};
    if(!evidence.slotMatches||!evidence.generationMatches)return {...screen,status:"superseded"};
    if(now>=expiry)return {...screen,status:"expired"};
    if(!evidence.balanceCurrent||!evidence.balanceValidUntil||!Number.isFinite(Date.parse(evidence.balanceValidUntil))||now>Date.parse(evidence.balanceValidUntil))return {...screen,status:"stale_balance"};
    return {...screen,status:evidence.intentState==="REVIEW_READY"?"current":"unavailable"};
  } catch {return {...screen,review:null};}
}

export function reviewStatusAt(screen: ReviewScreen, now: number): ReviewScreen["status"] {
  if(screen.status!=="current"&&screen.status!=="stale_balance")return screen.status;
  if(!Number.isFinite(now)||now<Date.parse(screen.serverNow))return "unavailable";
  if(screen.review&&now>=Date.parse(screen.review.localExpiresAt))return "expired";
  return screen.status==="stale_balance"||!screen.balanceValidUntil||now>Date.parse(screen.balanceValidUntil)?"stale_balance":"current";
}

export function exactDisplayAmount(value: string, minimumFraction = 2): string {
  if(!Number.isInteger(minimumFraction)||minimumFraction<0||minimumFraction>18)throw new Error("Invalid display precision");
  const [whole,fraction=""]=parseAmount(value).split("."),digits=fraction.padEnd(minimumFraction,"0");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g,",")}${digits?"."+digits:""}`;
}
