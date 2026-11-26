import type {IntentState,PreparationSafety} from "./types";
import type {RecoveryEvidence,RecoveryKind,RecoveryDisposition} from "./recovery-types";
export class ActivityError extends Error {
 constructor(readonly code:"invalid_request"|"not_found"|"unavailable"){super("Saved order records are unavailable");this.name="ActivityError";}
}
export type ActivitySummary=Readonly<{id:string;operationKind?:"buy"|"sell"|"exit";state:IntentState;source:PreparationSafety;requestedQuantity:string;quantityUnit:"quote"|"base";assetId:string;assetLabel:string|null;quoteCurrency:string|null;createdAt:string;updatedAt:string;reservationHeld:boolean;requiresReview:boolean;settlementVerified:boolean;canExecute:false}>;
export type OrderRecord=ActivitySummary & Readonly<{
 sale?:import("./disposal-activity-types").SaleActivity;
 providerOrderId:string|null;
 approval:Readonly<{approvedAt:string;network:"solana";reviewRevision:number;planningRevision:number;planningDate:string;maximumDebit:string;cashBefore:string;commitments:string;buffer:string;expectedQuantity:string;quotedFee:string;quoteObservedAt:string}>|null;
 actual:(RecoveryEvidence & Readonly<{recordedAt:string}>)|null;
 latestCheck:Readonly<{at:string;kind:RecoveryKind;disposition:RecoveryDisposition}>|null;
 settlement:Readonly<{method:"manual";verifiedAt:string;balanceObservedAt:string;cashBefore:string;cashAfter:string;actualDebit:string;interveningCredits:string;interveningDebits:string}>|null;
 chainReference:null;
}>;
export type ActivityPage=Readonly<{items:readonly ActivitySummary[];nextCursor:string|null}>;
export type ActivityScreen=Readonly<{scope:string;serverNow:string;sample:boolean;data:Readonly<{kind:"list";page:ActivityPage}|{kind:"order";order:OrderRecord}>}>;
export type ActivityResponse=Readonly<{ok:true;screen:ActivityScreen}|{ok:false;code:"unauthenticated"|"session_changed"|"not_found"|"invalid_request"|"unavailable";message:string}>;
