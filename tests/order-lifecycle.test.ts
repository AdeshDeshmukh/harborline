import { expect, test, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { normalizeIntentRequest } from "../src/features/orders/request.server";
import { canAdvance, cleanupDecision } from "../src/features/orders/lifecycle";
const command={requestKey:"request-1",operationKind:"buy",assetId:"11111111-1111-4111-8111-111111111111",requestedQty:"100.00",qtyUnit:"quote",calculationId:"22222222-2222-4222-8222-222222222222",expectedPolicyRevision:3};
test("canonical request hash matches equivalent decimal spellings but changes with economics",()=>{
 const first=normalizeIntentRequest(command),second=normalizeIntentRequest({...command,requestedQty:"100.000000"});
 expect(first.hash).toBe(second.hash);expect(first.command.requestedQty).toBe("100");
 expect(first.hash).not.toBe(normalizeIntentRequest({...command,requestedQty:"101"}).hash);
 expect(first.hash).not.toBe(normalizeIntentRequest({...command,expectedPolicyRevision:4}).hash);
 expect(Object.isFrozen(first.command)).toBe(true);
});
test.each([{ownerId:"forged"},{requestedQty:"0"},{requestedQty:"-1"},{requestedQty:"1.0000001"},{qtyUnit:"base"},{calculationId:null},{expectedPolicyRevision:0}])("invalid or forged request fields are rejected: %j",fields=>{expect(()=>normalizeIntentRequest({...command,...fields})).toThrow();});
test("financial or unknown states never return to preparation or submission",()=>{
 for(const from of ["SUBMITTING","PENDING","UNKNOWN","COMPLETE","FAILED","CANCELED","MANUAL_REVIEW"] as const){expect(canAdvance(from,"PREPARING")).toBe(false);expect(canAdvance(from,"REVIEW_READY")).toBe(false);expect(canAdvance(from,"SUBMITTING")).toBe(false);}
 expect(canAdvance("REVIEW_READY","SUBMITTING")).toBe(true);expect(canAdvance("UNKNOWN","COMPLETE")).toBe(true);expect(canAdvance("COMPLETE","PENDING")).toBe(false);
});
test("only a definitely unsigned fixture preparation may expire and release on lease age",()=>{
 const now=new Date("2026-11-25T12:00:30Z");
 const base={state:"PREPARING" as const,effectsPossible:false,preparationSafety:"unverified" as const,createdAt:"2026-11-25T12:00:00Z",preparationLeaseUntil:now.toISOString(),reviewExpiresAt:null,policyRevision:3};
 expect(cleanupDecision(base,3,now)).toEqual({state:"UNKNOWN",release:false});
 expect(cleanupDecision({...base,preparationSafety:"contract_fixture"},3,now)).toEqual({state:"EXPIRED",release:true});
 for(const state of ["SUBMITTING","PENDING","UNKNOWN","COMPLETE","FAILED","CANCELED","MANUAL_REVIEW"] as const)expect(cleanupDecision({...base,state,effectsPossible:true},4,new Date("2027-01-01T00:00:00Z"))).toBeNull();
});
test("a stale or expired review cannot silently become unsigned without a verified fixture path",()=>{
 const now=new Date("2026-11-25T12:00:10Z"),base={state:"REVIEW_READY" as const,effectsPossible:false,preparationSafety:"contract_fixture" as const,createdAt:now.toISOString(),preparationLeaseUntil:null,reviewExpiresAt:"2026-11-25T12:00:20Z",policyRevision:3};
 expect(cleanupDecision(base,3,now)).toBeNull();expect(cleanupDecision(base,4,now)).toEqual({state:"EXPIRED",release:true});
 expect(cleanupDecision({...base,preparationSafety:"unverified"},4,now)).toEqual({state:"UNKNOWN",release:false});
});
