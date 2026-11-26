import "server-only";
import {randomUUID} from "node:crypto";
import {getVerifiedSession} from "../identity/session.server";
import {loadAuthConfig} from "../identity/config.server";
import {normalizeIntentRequest} from "./request.server";
type Options={origin?:()=>string|null;session?:typeof getVerifiedSession};
class Rejected extends Error{constructor(readonly status:number,readonly code:string){super("Sale review unavailable");}}
/** No service/adapter injection: a session cannot enable live sales or bootstrap an account. */
export function createDisposalHandlers(options:Options={}){return {async post(request:Request):Promise<Response>{
 const requestId=randomUUID();
 const json=(status:number,code:string)=>Response.json({code,message:code==="unauthenticated"?"Sign-in is required":"Sale review is unavailable",requestId,recoverable:false},{status,headers:{"Cache-Control":"private, no-store, max-age=0",Pragma:"no-cache",Expires:"0"}});
 try{
  if(request.method!=="POST")throw new Rejected(405,"method_not_allowed");
  const origin=(options.origin??(()=>loadAuthConfig()?.appOrigin??null))();if(!origin)throw new Rejected(503,"integration_unverified");
  if(request.headers.get("origin")!==origin)throw new Rejected(403,"invalid_origin");if(new URL(request.url).search)throw new Rejected(400,"invalid_request");
  if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")throw new Rejected(415,"invalid_content_type");
  const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
  if(reader)while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>4096){await reader.cancel().catch(()=>{});throw new Rejected(413,"body_too_large");}chunks.push(next.value);}
  let body:unknown;try{body=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new Rejected(400,"invalid_json");}
  if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).length!==3||Object.keys(body).some(k=>!["assetId","amount","policyRevision"].includes(k)))throw new Rejected(400,"invalid_request");
  const r=body as Record<string,unknown>;
  try{normalizeIntentRequest({requestKey:request.headers.get("idempotency-key"),operationKind:"sell",assetId:r.assetId,requestedQty:r.amount,qtyUnit:"base",calculationId:null,expectedPolicyRevision:r.policyRevision});}catch{throw new Rejected(400,"invalid_request");}
  if(!await (options.session??getVerifiedSession)())throw new Rejected(401,"unauthenticated");
  return json(503,"integration_unverified");
 }catch(e){return e instanceof Rejected?json(e.status,e.code):json(503,"unavailable");}
}};}
export const disposalHandlers=createDisposalHandlers();
