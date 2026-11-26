import type {ActivitySummary} from "./activity-types";
export function activityCopy(order:ActivitySummary){
 if(order.requiresReview||order.state==="MANUAL_REVIEW")return {title:"Review required",detail:"This order needs review before another decision. Do not place another order to resolve it."};
 switch(order.state){
  case "UNKNOWN":return {title:"Outcome not confirmed",detail:"Do not place another order. The outcome and cash impact still need checking."};
  case "SUBMITTING":case "PENDING":return {title:"Order in progress",detail:"A final outcome has not been recorded. Reloading reads saved information only."};
  case "COMPLETE":return {title:"Order reported complete",detail:"A completed order report does not establish that cash is settled or available."};
  case "FAILED":return {title:"Order reported failed",detail:"Some assets may have been bought. Check recorded fills and cash verification before making another decision."};
  case "CANCELED":return {title:"Order reported canceled",detail:"Cancellation may follow a partial fill. The recorded quantities and cash verification are separate."};
  case "DRAFT":case "PREPARING":case "REVIEW_READY":return {title:"Not approved",detail:"This saved request has no recorded approval. Trading is unavailable."};
  default:return {title:"Request closed",detail:"This request is closed. Any recorded evidence is shown below."};
 }
}

export function savedCheckCopy(check:NonNullable<import("./activity-types").OrderRecord["latestCheck"]>){
 const kind={observed:"Order information recorded",initialized:"Outcome not confirmed",unavailable:"Read unavailable",not_found:"Order not found",invalid_response:"Report not understood"}[check.kind];
 const disposition={applied:"saved",ignored:"did not replace earlier evidence",conflict:"requires review"}[check.disposition];
 return kind+" · "+disposition;
}
