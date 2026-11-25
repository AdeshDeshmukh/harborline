import "server-only";
import type {NextRequest} from "next/server";
import {getVerifiedSession} from "../identity/session.server";
import {OwnerAccessError,requireOwnerContext} from "../identity/access.server";
import {loadAuthConfig} from "../identity/config.server";
import {normalizeApprovalCommand} from "./approval-command";
import {ApprovalError} from "./approval-types";
import {randomUUID} from "node:crypto";
import type {createSignedApprovalService} from "./execute.server";
type Options={origin?:()=>string|null;session?:typeof getVerifiedSession;owner?:typeof requireOwnerContext;service?:()=>ReturnType<typeof createSignedApprovalService>};
class HttpError extends Error{constructor(readonly status:number,readonly code:string){super("Approval request was rejected");}}
export function createApprovalHandlers(options:Options={}){return {async post(request:NextRequest,intentId:string){
 const requestId=randomUUID();
 try{
  const origin=(options.origin??(()=>loadAuthConfig()?.appOrigin??null))();
  if(!origin)throw new ApprovalError("disabled");
  if(request.headers.get("origin")!==origin)throw new HttpError(403,"invalid_origin");
  if(new URL(request.url).search)throw new ApprovalError("invalid_request");
  if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")throw new HttpError(415,"invalid_content_type");
  const chunks:Uint8Array[]=[];let size=0;const reader=request.body?.getReader();
  if(reader)while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>4096){await reader.cancel().catch(()=>{});throw new HttpError(413,"body_too_large");}chunks.push(next.value);}
  let value:unknown;try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new ApprovalError("invalid_request");}
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==3||Object.keys(value).some(k=>!["reviewRevision","termsHash","acknowledged"].includes(k)))throw new ApprovalError("invalid_request");
  const command=normalizeApprovalCommand({...value,intentId});
  if(!options.service){if(!await(options.session??getVerifiedSession)())throw new OwnerAccessError("unauthenticated");throw new ApprovalError("disabled");}
  const context=await(options.owner??requireOwnerContext)();
  const result=await options.service().approve(context,command);
  // Explicit public receipt fields only. No future service metadata can leak.
  return json({intentId:result.intentId,approvalId:result.approvalId,attemptId:result.attemptId,reviewRevision:result.reviewRevision,termsHash:result.termsHash,approvedAt:result.approvedAt,state:result.state,source:result.source,accepted:result.accepted,canExecute:false},200);
 }catch(e){
  const code=e instanceof HttpError?e.code:e instanceof OwnerAccessError&&e.code==="unauthenticated"?"unauthenticated":e instanceof ApprovalError?e.code:"unavailable";
  const status=e instanceof HttpError?e.status:code==="unauthenticated"?401:code==="invalid_request"?400:code==="not_found"?404:code==="disabled"||code==="unavailable"?503:409;
  return json({code,message:"Approval is unavailable",requestId,recoverable:status===409},status);
 }
}};}
export const approvalHandlers=createApprovalHandlers();
function json(body:unknown,status:number){return Response.json(body,{status,headers:{"Cache-Control":"private, no-store, max-age=0",Pragma:"no-cache",Expires:"0"}});}
