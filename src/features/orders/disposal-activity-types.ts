import type {DisposalReconciliation} from "./disposal-types";
/** Browser-safe saved economics; no operator, provider identity or payload bindings. */
export type SaleActivity=Readonly<{
 review:Readonly<{requestedBase:string;maximumBaseDebit:string;expectedGrossQuote:string;quotedFeeQuote:string;maximumFeeQuote:string;expectedNetQuote:string;minimumNetQuote:string;createdAt:string;expiresAt:string;revision:number}>|null;
 approval:Readonly<{approvedAt:string;stockBefore:string;cashBefore:string}>|null;
 actualGrossQuote:string|null;actualNetQuote:string|null;
 settlement:(DisposalReconciliation & Readonly<{verifiedAt:string;balanceObservedAt:string}>)|null;
}>;
