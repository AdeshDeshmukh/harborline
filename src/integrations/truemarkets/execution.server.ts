import "server-only";
import {ApprovalError} from "../../features/orders/approval-types";
import {isUuid} from "../../server/env";
export function createOrderExecutionAdapter(transport:{request(method:"POST",path:string,options:{userId:string;body:unknown}):Promise<unknown>}){
  return {async execute(input:{source:"contract_fixture"|"provider";providerUserId:string;providerOrderId:string;signatures:readonly string[];assertCurrent:()=>void}):Promise<"complete"|"pending"|"failed"|"canceled"|null>{
    if(input.source!=="contract_fixture")throw new ApprovalError("disabled");
    if(typeof input.assertCurrent!=="function"||!isUuid(input.providerUserId)||typeof input.providerOrderId!=="string"||input.providerOrderId.length>128||!/^[A-Za-z0-9_-]+$/.test(input.providerOrderId)||!Array.isArray(input.signatures)||input.signatures.length<1||input.signatures.length>8||input.signatures.some(s=>typeof s!=="string"||s.length>4096||!/^[A-Za-z0-9_-]+$/.test(s)))throw new ApprovalError("invalid_request");
    const path=`/v1/gateway/orders/${input.providerOrderId}/execute`,request={userId:input.providerUserId,body:{auth_type:"api_key",signatures:[...input.signatures]}};
    let value:unknown;
    try{
      input.assertCurrent(); // No await between the final guard and handoff.
      value=await transport.request("POST",path,request);
    }catch{throw new ApprovalError("unavailable");}
    if(!value||typeof value!=="object"||Array.isArray(value))return null;
    const status=(value as Record<string,unknown>).status;
    return status==="complete"||status==="pending"||status==="failed"||status==="canceled"?status:null;
  }};
}
