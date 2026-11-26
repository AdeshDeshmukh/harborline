import "server-only";
import {createHash} from "node:crypto";
import type {DisposalReview} from "./disposal-types";
import type {SaleVaultBinding,StoredSaleTerms} from "./disposal-store-types";
import {normalizeDisposalReview} from "./disposal-review";
import {bounded,fail,matchBinding,normalizeDisposalBinding,record,uuid} from "./disposal-validation";
export function normalizeSaleVaultBinding(value:unknown):SaleVaultBinding {
  const r=record(value,["operationKind","holdingReadId","ownerId","accountId","providerUserId","intentId","generation","policyRevision","assetId","assetAddress","cashId","baseDecimals"]);
  if(r.operationKind!=="sell")fail();
  const rest={...r},holdingReadId=r.holdingReadId;delete rest.operationKind;delete rest.holdingReadId;
  return Object.freeze({...normalizeDisposalBinding(rest),operationKind:"sell",holdingReadId:uuid(holdingReadId)});
}
export function buildStoredSaleTerms(reviewValue:DisposalReview,readId:string):StoredSaleTerms {
  return bounded(()=>{const review=normalizeDisposalReview(reviewValue);return Object.freeze({version:2,operationKind:"sell",binding:Object.freeze({...review.binding,operationKind:"sell",holdingReadId:uuid(readId)}),review});});
}
export function normalizeStoredSaleTerms(value:unknown):StoredSaleTerms {
  return bounded(()=>{
    const r=record(value,["version","operationKind","binding","review"]);if(r.version!==2||r.operationKind!=="sell")fail();
    const binding=normalizeSaleVaultBinding(r.binding),review=normalizeDisposalReview(r.review),expected:Record<string,unknown>={...binding};delete expected.operationKind;delete expected.holdingReadId;
    matchBinding(review.binding,normalizeDisposalBinding(expected));return Object.freeze({version:2,operationKind:"sell",binding,review});
  });
}
export function hashStoredSaleTerms(value:unknown):string {
  const terms=normalizeStoredSaleTerms(value);
  return createHash("sha256").update(JSON.stringify(["harborline-sale-terms-v2",terms])).digest("hex");
}
