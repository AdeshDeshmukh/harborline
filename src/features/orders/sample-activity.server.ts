import "server-only";
import type {ActivityScreen,OrderRecord} from "./activity-types";
import {sampleDisposal} from "./sample-disposal.server";
export const activityScenarios=["pending","unknown","complete","verified","partial-failed","review","sale-complete","sale-partial"] as const;
export function sampleActivity(scenario:string):ActivityScreen{
 const at="2026-11-25T12:00:05.000Z";
 function order(name:string):OrderRecord{
  if(name==="sale-complete"||name==="sale-partial")return sampleDisposal(name);
  const verified=name==="verified",failed=name==="partial-failed",hasOutcome=verified||failed||name==="complete";
  return {id:name,state:name==="pending"?"PENDING":name==="unknown"?"UNKNOWN":failed?"FAILED":name==="review"?"MANUAL_REVIEW":"COMPLETE",source:"contract_fixture",requestedQuantity:"100",quantityUnit:"quote",assetId:"Fictional sample asset",assetLabel:"SAMPLE · fictional tokenized stock",quoteCurrency:"USDC",createdAt:at,updatedAt:at,reservationHeld:!verified,requiresReview:name==="review",settlementVerified:verified,canExecute:false,providerOrderId:"sample-order-"+name,
   approval:{approvedAt:at,network:"solana",reviewRevision:1,planningRevision:2,planningDate:"2026-11-25",maximumDebit:"100.5",cashBefore:"2000",commitments:"1200",buffer:"500",expectedQuantity:"0.5",quotedFee:"0.5",quoteObservedAt:"2026-11-25T12:00:00.000Z"},
   actual:hasOutcome?{providerStatus:failed?"failed":"complete",filledBase:failed?"0.2":"0.5",remainingBase:failed?"0.3":"0",averagePriceQuote:"200",feeQuote:failed?"0.2":"0.5",partial:failed,recordedAt:at}:null,
   latestCheck:{at,kind:hasOutcome?"observed":"unavailable",disposition:"applied"},
   settlement:verified?{method:"manual",verifiedAt:at,balanceObservedAt:at,cashBefore:"2000",cashAfter:"1899.5",actualDebit:"100.5",interveningCredits:"0",interveningDebits:"0"}:null,chainReference:null};
 }
 return {scope:"fixed-public-example",serverNow:at,sample:true,data:scenario==="list"||scenario==="empty"?{kind:"list",page:{items:scenario==="empty"?[]:activityScenarios.map(order),nextCursor:null}}:{kind:"order",order:order(scenario)}};
}
