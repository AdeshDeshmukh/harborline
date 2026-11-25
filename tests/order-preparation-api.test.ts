import {expect,test,vi} from "vitest";
import {NextRequest} from "next/server";
vi.mock("server-only",()=>({}));
import {createPreparationHandlers} from "../src/features/orders/handlers.server";
import {assets,binding} from "./fixtures/investment-review";
const origin="https://harborline.example.invalid";
const input={assetId:assets.stock.id,amount:"100.00",policyRevision:2,calculationId:binding.calculationId};
function request(body:unknown=input,source=origin,media="application/json",key="fixture_request_1"){return new NextRequest(origin+"/api/investments/review",{method:"POST",headers:{Origin:source,"Content-Type":media,"Idempotency-Key":key},body:typeof body==="string"?body:JSON.stringify(body)});}
test("disabled endpoint verifies only the session and cannot bootstrap an account",async()=>{
  const owner=vi.fn(async()=>{throw new Error("must not bootstrap");});
  const handlers=createPreparationHandlers({origin:()=>origin,owner,session:async()=>({id:binding.accountId,email:"builder@example.invalid"})});
  const response=await handlers.post(request());expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:"integration_unverified",recoverable:false});expect(response.headers.get("cache-control")).toContain("no-store");expect(owner).not.toHaveBeenCalled();
});
test("anonymous requests cannot access preparation",async()=>{
  const handlers=createPreparationHandlers({origin:()=>origin,session:async()=>null});expect((await handlers.post(request())).status).toBe(401);
});
test("cross-site, malformed and excessive commands cannot reach owner lookup",async()=>{
  const owner=vi.fn(async()=>{throw new Error("private DB secret");}),handlers=createPreparationHandlers({origin:()=>origin,owner});
  expect((await handlers.post(request(input,"https://evil.invalid"))).status).toBe(403);
  expect((await handlers.post(request(input,origin,"text/plain"))).status).toBe(415);
  expect((await handlers.post(request("{"))).status).toBe(400);
  expect((await handlers.post(request("x".repeat(4097)))).status).toBe(413);
  for(const body of [{...input,ownerId:binding.accountId},{...input,payload:"client-controlled"},{...input,amount:100},{...input,policyRevision:0}])expect((await handlers.post(request(body))).status).toBe(400);
  expect((await handlers.post(request(input,origin,"application/json",""))).status).toBe(400);expect(owner).not.toHaveBeenCalled();
});
test("dependency failures return bounded errors without private details",async()=>{
  const handlers=createPreparationHandlers({origin:()=>origin,session:async()=>{throw new Error("private token and SQL");}});
  const response=await handlers.post(request());expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toContain("private");
});
