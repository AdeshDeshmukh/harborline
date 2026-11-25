import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {createOrderPreparationAdapter} from "../src/integrations/truemarkets/preparation.server";
import {response,assets} from "./fixtures/investment-review";
const providerUserId="66666666-6666-4666-8666-666666666666";
test("fixture adapter pins DeFi market buy and sends only the owned customer identity",async()=>{
  const calls:unknown[]=[];const adapter=createOrderPreparationAdapter({async request(...args){calls.push(args);return response();}});
  expect(await adapter.prepare({source:"contract_fixture",providerUserId,assetId:assets.stock.id,amount:"100.00"})).toMatchObject({venue:"defi",status:"initialized"});
  expect(calls).toEqual([["POST","/v1/gateway/orders",{userId:providerUserId,body:{asset_id:assets.stock.id,qty:"100",qty_unit:"quote",side:"buy",type:"market",chain:"solana",venue:"defi"}}]]);
});
test("provider mode cannot issue a private order request",async()=>{
  const request=vi.fn(async()=>response()),adapter=createOrderPreparationAdapter({request});
  await expect(adapter.prepare({source:"provider",providerUserId,assetId:assets.stock.id,amount:"100"})).rejects.toMatchObject({code:"integration_unverified"});expect(request).not.toHaveBeenCalled();
});
test("uncertain mutation is never retried by the preparation adapter",async()=>{
  let calls=0;const adapter=createOrderPreparationAdapter({async request(){calls++;throw new Error("private failure");}});
  await expect(adapter.prepare({source:"contract_fixture",providerUserId,assetId:assets.stock.id,amount:"100"})).rejects.toThrow();expect(calls).toBe(1);
});
