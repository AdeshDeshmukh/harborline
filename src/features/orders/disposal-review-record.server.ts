import "server-only";
import {and,eq} from "drizzle-orm";
import {disposalReviews} from "../../server/db/schema";
import type {OwnerContext} from "../identity/access.server";
import type {DisposalStore,SaleTx,SaleAccount,SaleIntent} from "./disposal-store.server";
import {ApprovalError} from "./approval-types";
import type {StoredSaleTerms} from "./disposal-store-types";
import {normalizeStoredSaleTerms,hashStoredSaleTerms} from "./disposal-terms.server";
import {matchBinding,quantity} from "./disposal-validation";
export type StoredSaleReviewView={intentId:string;revision:number;termsHash:string;terms:StoredSaleTerms;expiresAt:string};
export const saleReviewSelection={id:disposalReviews.id,accountId:disposalReviews.accountId,intentId:disposalReviews.intentId,revision:disposalReviews.revision,holdingReadId:disposalReviews.holdingReadId,terms:disposalReviews.terms,termsHash:disposalReviews.termsHash,maximumBaseDebit:disposalReviews.maximumBaseDebit,createdAt:disposalReviews.createdAt,expiresAt:disposalReviews.expiresAt};
export function projectStoredSaleReview(row:Pick<typeof disposalReviews.$inferSelect,keyof typeof saleReviewSelection>):StoredSaleReviewView {
 const terms=normalizeStoredSaleTerms(row.terms),r=terms.review;
 if(hashStoredSaleTerms(terms)!==row.termsHash||r.binding.intentId!==row.intentId||r.binding.accountId!==row.accountId||r.binding.generation!==row.revision||terms.binding.holdingReadId!==row.holdingReadId||r.createdAt!==row.createdAt.toISOString()||r.quote.expiresAt!==row.expiresAt.toISOString()||quantity(row.maximumBaseDebit,r.binding.baseDecimals)!==r.requestedBase)throw new ApprovalError("unavailable");
 return {intentId:row.intentId,revision:row.revision,termsHash:row.termsHash,terms,expiresAt:row.expiresAt.toISOString()};
}
export async function currentSaleReview(store:DisposalStore,tx:SaleTx,ctx:OwnerContext,a:SaleAccount,i:SaleIntent){
 const [row]=await tx.select(saleReviewSelection).from(disposalReviews).where(and(eq(disposalReviews.intentId,i.id),eq(disposalReviews.accountId,a.id),eq(disposalReviews.revision,i.preparationGeneration)));
 if(!row)throw new ApprovalError("conflict");const view=projectStoredSaleReview(row);
 matchBinding(view.terms.review.binding,store.binding(ctx,a,i));if(view.terms.review.requestedBase!==quantity(i.requestedQty,view.terms.binding.baseDecimals)||view.terms.review.quote.providerOrderId!==i.providerOrderId)throw new ApprovalError("conflict");return {row,view};
}
