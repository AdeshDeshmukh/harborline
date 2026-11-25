import {expect,test,vi} from "vitest";
import {NextRequest} from "next/server";
vi.mock("server-only",()=>({}));
import {createApprovalHandlers} from "../src/features/orders/approval-handlers.server";
import type {OwnerContext} from "../src/features/identity/access.server";
const id="44444444-4444-4444-8444-444444444444",body={reviewRevision:1,termsHash:"a".repeat(64),acknowledged:true};
function request(value:unknown=body,origin="https://harborline.example"){return new NextRequest("https://harborline.example/api/investments/"+id+"/approve",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(value)});}
test("runtime approval verifies session but never bootstraps an owner or composes execution",async()=>{
 let sessions=0,owners=0;
 const h=createApprovalHandlers({origin:()=>"https://harborline.example",session:async()=>{sessions++;return {id:"33333333-3333-4333-8333-333333333333",email:"fixture@example.invalid"};},owner:async()=>{owners++;throw new Error("must not bootstrap");}});
 const response=await h.post(request(),id);expect(response.status).toBe(503);expect(sessions).toBe(1);expect(owners).toBe(0);
 expect(response.headers.get("cache-control")).toContain("no-store");
});
test("anonymous approval returns 401",async()=>{
 const h=createApprovalHandlers({origin:()=>"https://harborline.example",session:async()=>null});expect((await h.post(request(),id)).status).toBe(401);
});
test.each(["ownerId","payloads","signatures","maximumDebit","enabled","intentId"])("caller %s is rejected before authentication or execution",async key=>{
 let sessions=0;const h=createApprovalHandlers({origin:()=>"https://harborline.example",session:async()=>{sessions++;return null;}});
 expect((await h.post(request({...body,[key]:"injected"}),id)).status).toBe(400);expect(sessions).toBe(0);
});
test("cross-origin approval fails before session lookup",async()=>{
 let sessions=0;const h=createApprovalHandlers({origin:()=>"https://harborline.example",session:async()=>{sessions++;return null;}});
 expect((await h.post(request(body,"https://other.example"),id)).status).toBe(403);expect(sessions).toBe(0);
});
test("an injected fixture service receives only the path-bound command and returns a projected receipt",async()=>{
 let seen:unknown;
 const h=createApprovalHandlers({origin:()=>"https://harborline.example",owner:async()=>({ownerId:"33333333-3333-4333-8333-333333333333",accountId:"55555555-5555-4555-8555-555555555555",externalRefId:"fixture",email:"fixture@example.invalid"} as OwnerContext),service:()=>({async approve(_ctx,command){seen=command;return {intentId:id,approvalId:"a",attemptId:"b",reviewRevision:1,termsHash:body.termsHash,approvedAt:"2026-11-25T12:00:00.000Z",state:"UNKNOWN" as const,source:"contract_fixture" as const,accepted:true,canExecute:false as const,secret:"never serialize"};}})});
 const response=await h.post(request(),id),value=await response.json();
 expect(response.status).toBe(200);expect(seen).toEqual({...body,intentId:id});expect(value).toMatchObject({state:"UNKNOWN",canExecute:false});expect(JSON.stringify(value)).not.toContain("secret");
});
test.each(["acknowledgement","query","oversized"])("invalid %s cannot reach an owner lookup",async kind=>{
 let owners=0;const h=createApprovalHandlers({origin:()=>"https://harborline.example",owner:async()=>{owners++;throw new Error("must not run");}});
 const r=kind==="query"?new NextRequest("https://harborline.example/api/investments/"+id+"/approve?enabled=true",{method:"POST",headers:{origin:"https://harborline.example","content-type":"application/json"},body:JSON.stringify(body)}):request(kind==="oversized"?{...body,termsHash:"a".repeat(5000)}:{...body,acknowledged:false});
 expect((await h.post(r,id)).status).toBe(kind==="oversized"?413:400);expect(owners).toBe(0);
});
