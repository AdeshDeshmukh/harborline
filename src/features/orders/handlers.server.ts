import "server-only";
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import type { createPreparationService } from "./prepare.server";
import { getVerifiedSession } from "../identity/session.server";
import { OwnerAccessError, requireOwnerContext } from "../identity/access.server";
import { loadAuthConfig } from "../identity/config.server";
import { normalizeIntentRequest } from "./request.server";
import { IntentStoreError } from "./types";
import { ReviewError } from "./review-types";
type Options={origin?:()=>string|null;session?:typeof getVerifiedSession;owner?:typeof requireOwnerContext;service?:()=>ReturnType<typeof createPreparationService>};
class HttpError extends Error{constructor(readonly status:number,readonly code:string){super("Investment review request was rejected");}}
export function createPreparationHandlers(options:Options={}){
  const origin=options.origin??(()=>loadAuthConfig()?.appOrigin??null);
  return {async post(request:NextRequest):Promise<Response>{
    const requestId=randomUUID();
    try{
      const allowed=origin();if(!allowed)throw new ReviewError("integration_unverified");
      if(request.headers.get("origin")!==allowed)throw new HttpError(403,"invalid_origin");
      if(new URL(request.url).search)throw new ReviewError("invalid_request");
      const body=await jsonBody(request);
      if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).length!==4||Object.keys(body).some(key=>!["assetId","amount","policyRevision","calculationId"].includes(key)))throw new ReviewError("invalid_request");
      const row=body as Record<string,unknown>;
      const {command}=normalizeIntentRequest({requestKey:request.headers.get("idempotency-key"),operationKind:"buy",assetId:row.assetId,requestedQty:row.amount,qtyUnit:"quote",calculationId:row.calculationId,expectedPolicyRevision:row.policyRevision});
      if(!options.service){
        // Deliberately check only the session: disabled preparation must not
        // bootstrap an account, connect to the DB, or initialize a live adapter.
        if(!await (options.session??getVerifiedSession)())throw new OwnerAccessError("unauthenticated");
        throw new ReviewError("integration_unverified");
      }
      const context=await (options.owner??requireOwnerContext)();
      return json(await options.service().prepare(context,command),200);
    }catch(error){
      if(error instanceof HttpError)return json({code:error.code,message:error.message,requestId,recoverable:false},error.status);
      if(error instanceof OwnerAccessError&&error.code==="unauthenticated")return json({code:"unauthenticated",message:"Sign-in is required",requestId,recoverable:false},401);
      const code=error instanceof ReviewError||error instanceof IntentStoreError?error.code:"unavailable";
      const status=code==="invalid_request"?400:code==="not_found"?404:code==="integration_unverified"||code==="unavailable"?503:409;
      return json({code,message:"Investment review is unavailable",requestId,recoverable:code!=="integration_unverified"&&(status===409||status===503)},status);
    }
  }};
}
export const preparationHandlers=createPreparationHandlers();
function json(body:unknown,status:number){return Response.json(body,{status,headers:{"Cache-Control":"private, no-store, max-age=0",Pragma:"no-cache",Expires:"0"}});}
async function jsonBody(request:NextRequest):Promise<unknown>{
  if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")throw new HttpError(415,"invalid_content_type");
  const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
  if(reader)while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>4096){await reader.cancel().catch(()=>{});throw new HttpError(413,"body_too_large");}chunks.push(next.value);}
  try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new HttpError(400,"invalid_json");}
}
