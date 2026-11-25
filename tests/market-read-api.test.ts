import { expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
import { createMarketReadHandlers } from "../src/features/market-data/handlers.server";
import { OwnerAccessError, type OwnerContext } from "../src/features/identity/access.server";
import { ReadContractError } from "../src/integrations/truemarkets/read-types";
const owner={accountId:"55555555-5555-4555-8555-555555555555",ownerId:"44444444-4444-4444-8444-444444444444"} as OwnerContext;
test("runtime integration remains hard-disabled for an authenticated account",async()=>{
 const handlers=createMarketReadHandlers({owner:async()=>owner});
 const response=await handlers.balance(new NextRequest("https://app.example.invalid/api/account/balance"));
 expect(response.status).toBe(503); expect(await response.json()).toMatchObject({code:"integration_unverified",recoverable:false});
 expect(response.headers.get("cache-control")).toContain("private, no-store");
});
test("missing sessions cannot read balances or eligible assets",async()=>{
 const handlers=createMarketReadHandlers({owner:async()=>{throw new OwnerAccessError("unauthenticated");}});
 for(const read of [handlers.balance,handlers.assets]){const response=await read(new NextRequest("https://app.example.invalid/api/account/balance"));expect(response.status).toBe(401);}
});
test("caller account, provider identity and country selectors are rejected",async()=>{
 const handlers=createMarketReadHandlers({owner:async()=>owner});
 for(const query of ["userId=forged","country=DE","assetId=forged","accountId=forged"]){const response=await handlers.balance(new NextRequest(`https://app.example.invalid/api/account/balance?${query}`));expect(response.status).toBe(400);}
});
test("injected owned fixture responses stay labeled and never receive caller identity",async()=>{
 const handlers=createMarketReadHandlers({owner:async()=>owner,service:()=>({assets:async ctx=>{expect(ctx).toBe(owner);return {source:"contract_fixture",canAuthorize:false};},balance:async ctx=>{expect(ctx).toBe(owner);return {source:"contract_fixture",canAuthorize:false,balance:{available:"1500"}};}})});
 const response=await handlers.balance(new NextRequest("https://app.example.invalid/api/account/balance"));expect(response.status).toBe(200);expect(await response.json()).toEqual({source:"contract_fixture",canAuthorize:false,balance:{available:"1500"}});
});
test("restriction and stale evidence errors are bounded while unexpected failures redact dependency details",async()=>{
 for(const [error,status,code] of [[new ReadContractError("restricted"),403,"restricted"],[new ReadContractError("stale_evidence"),409,"stale_evidence"],[new Error("private SQL detail"),503,"unavailable"]] as const){
  const handlers=createMarketReadHandlers({owner:async()=>owner,service:()=>({assets:async()=>{throw error;},balance:async()=>{throw error;}})});
  const response=await handlers.assets(new NextRequest("https://app.example.invalid/api/assets"));expect(response.status).toBe(status);const body=await response.json();expect(body.code).toBe(code);expect(JSON.stringify(body)).not.toContain("private SQL detail");
 }
});

test("disabled runtime checks a fresh authenticated session without bootstrapping a database account",async()=>{
 const handlers=createMarketReadHandlers({session:async()=>({id:owner.ownerId,email:"builder@example.invalid"})});
 const response=await handlers.balance(new NextRequest("https://app.example.invalid/api/account/balance"));
 expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:"integration_unverified"});
});
