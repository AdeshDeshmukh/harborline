import "server-only";
import type { OwnerContext } from "../identity/access.server";
import type { createIntentRepository } from "./repository.server";
import type { createReviewRepository } from "./reviews.server";
import type { createOrderPreparationAdapter } from "../../integrations/truemarkets/preparation.server";
import type { SupportedAssets } from "../../integrations/truemarkets/read-types";
import type { DefiQuote } from "../../integrations/truemarkets/quote-types";
import type { ReviewView } from "./review-types";
import { ReviewError } from "./review-types";
import { normalizeIntentRequest } from "./request.server";
import { normalizePreparationResponse } from "../../integrations/truemarkets/preparation.server";
import { normalizeQuoteRoute } from "../../integrations/truemarkets/quote-contracts";
import { compareAmounts, parseAmount } from "../planning/money";
export type PreparationResult={intentId:string;state:string;review:ReviewView|null;canApprove:false;canExecute:false};
export type PreparationDependencies={source:"contract_fixture"|"provider";intents:ReturnType<typeof createIntentRepository>;reviews:ReturnType<typeof createReviewRepository>;adapter:ReturnType<typeof createOrderPreparationAdapter>;assets:(context:OwnerContext)=>Promise<SupportedAssets>;terms:(quote:DefiQuote)=>unknown;clock:()=>Date};
export function createPreparationService(dependencies:PreparationDependencies){
  const deps={...dependencies};
  function now(){const value=deps.clock();if(!(value instanceof Date)||!Number.isFinite(value.getTime()))throw new ReviewError("unavailable");return new Date(value);}
  async function result(context:OwnerContext,id:string):Promise<PreparationResult>{return deps.reviews.current(context,id);}
  return {async prepare(context:OwnerContext,value:unknown):Promise<PreparationResult>{
    if(deps.source!=="contract_fixture")throw new ReviewError("integration_unverified");
    const {command}=normalizeIntentRequest(value);
    if(command.operationKind!=="buy"||!command.calculationId)throw new ReviewError("invalid_request");
    const claim=await deps.intents.claim(context,command);
    if(claim.replayed)return result(context,claim.intent.id);
    let inputs:Awaited<ReturnType<PreparationDependencies["reviews"]["inputs"]>>,quoteContext:Parameters<typeof normalizeQuoteRoute>[0];
    let preparing:Awaited<ReturnType<PreparationDependencies["reviews"]["begin"]>>;
    try{
      inputs=await deps.reviews.inputs(context,claim.intent.id);
      const assets=structuredClone(await deps.assets(context));
      quoteContext={source:"contract_fixture",assets,observedAt:now().toISOString(),baseIdentifier:assets.stock.symbol,quoteIdentifier:"USDC",side:"buy",qtyUnit:"quote",requestedAmount:command.requestedQty};
      const route=normalizeQuoteRoute(quoteContext);
      if(route.stockId!==command.assetId||route.cashId!==inputs.balanceListingId||compareAmounts(parseAmount(command.requestedQty),inputs.result.debitBudget)>0)throw new ReviewError("invalid_terms");
      preparing=await deps.reviews.begin(context,claim.intent.id,claim.intent.revision);
    }catch(error){await deps.intents.abandon(context,claim.intent.id,claim.intent.revision);throw error instanceof ReviewError?error:new ReviewError("invalid_terms");}
    const incident={intentId:preparing.id,expectedRevision:preparing.revision,generation:preparing.preparationGeneration};
    let raw:unknown;
    try{raw=await deps.adapter.prepare({source:"contract_fixture",providerUserId:preparing.providerUserId,assetId:command.assetId,amount:command.requestedQty});}
    catch{await deps.reviews.incident(context,{...incident,reason:"timeout",providerOrderId:null});return result(context,preparing.id);}
    const observed=normalizePreparationResponse(raw,quoteContext);
    if(observed.kind==="rejected"){await deps.reviews.reject(context,incident);return result(context,preparing.id);}
    if(observed.kind==="incident"){await deps.reviews.incident(context,{...incident,reason:observed.reason,providerOrderId:observed.providerOrderId});return result(context,preparing.id);}
    try{
      await deps.reviews.record(context,{...incident,prepared:observed,evidence:deps.terms(observed.quote)});
      return result(context,preparing.id);
    }catch{
      await deps.reviews.incident(context,{...incident,reason:"invalid_terms",providerOrderId:observed.providerOrderId});
      return result(context,preparing.id);
    }
  }};
}
