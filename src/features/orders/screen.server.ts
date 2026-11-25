import "server-only";
import { OwnerAccessError, requireOwnerContext } from "../identity/access.server";
import { createReviewScreenReader } from "./screen-reader.server";
import { ReviewError } from "./review-types";
import type { ReviewScreenResponse } from "./screen-types";
export function createReviewScreenController(deps:{owner?:typeof requireOwnerContext;reader?:()=>ReturnType<typeof createReviewScreenReader>}={}){
  return {async load(intentId:string,expectedScope?:string):Promise<ReviewScreenResponse>{
    try{
      const context=await (deps.owner??requireOwnerContext)();
      if(expectedScope!==undefined&&expectedScope!==context.accountId)return {ok:false,code:"session_changed",message:"The signed-in account changed. Open this review from your current account."};
      return {ok:true,screen:await (deps.reader??createReviewScreenReader)().load(context,intentId)};
    }catch(error){
      if(error instanceof OwnerAccessError&&error.code==="unauthenticated")return {ok:false,code:"unauthenticated",message:"Your session ended. Sign in again to view saved terms."};
      if(error instanceof ReviewError&&error.code==="not_found")return {ok:false,code:"not_found",message:"This review could not be found in your account."};
      return {ok:false,code:"unavailable",message:"We could not verify these saved terms. Reload before making a decision."};
    }
  }};
}
