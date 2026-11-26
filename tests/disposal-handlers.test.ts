import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {createDisposalHandlers} from "../src/features/orders/disposal-handlers.server";
const body={assetId:"11111111-1111-4111-8111-111111111111",amount:"0.5",policyRevision:2};
function request(value:unknown=body,origin="https://example.test"){return new Request("https://example.test/api/disposals/review",{method:"POST",headers:{origin,"content-type":"application/json","idempotency-key":"22222222-2222-4222-8222-222222222222"},body:JSON.stringify(value)});}
const session=vi.fn(async()=>({userId:"fixture"} as never));
const api=()=>createDisposalHandlers({origin:()=>"https://example.test",session});
test("authenticated sale boundary remains unconfigured without account bootstrap or provider composition",async()=>{
 const r=await api().post(request());expect(r.status).toBe(503);expect(await r.json()).toMatchObject({code:"integration_unverified",recoverable:false});expect(r.headers.get("cache-control")).toContain("private, no-store");
});
test.each(["operatorId","ownerId","providerUserId","source","calculationId"])("client %s cannot select a trusted authority",async k=>{expect((await api().post(request({...body,[k]:"forged"}))).status).toBe(400);});
test("unauthenticated and cross-origin callers fail without enabling execution",async()=>{
 expect((await createDisposalHandlers({origin:()=>"https://example.test",session:async()=>null}).post(request())).status).toBe(401);
 expect((await api().post(request(body,"https://other.test"))).status).toBe(403);
});
test("oversized, malformed and query-bearing requests are rejected",async()=>{
 expect((await api().post(request({...body,amount:"1".repeat(5000)}))).status).toBe(413);
 const r=request();expect((await api().post(new Request(r.url+"?operator=forged",r))).status).toBe(400);
 expect((await api().post(new Request(r.url,{method:"POST",headers:{origin:"https://example.test","content-type":"application/json"},body:"{"}))).status).toBe(400);
});
