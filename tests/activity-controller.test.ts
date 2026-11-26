import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {createActivityController} from "../src/features/orders/activity-controller.server";
import {OwnerAccessError,type OwnerContext} from "../src/features/identity/access.server";
import {ActivityError} from "../src/features/orders/activity-types";
const owner={ownerId:"11111111-1111-4111-8111-111111111111",accountId:"22222222-2222-4222-8222-222222222222"} as OwnerContext;
test("auth and current scope precede lazy reader creation for list and detail",async()=>{
 const reader=vi.fn();
 for(const method of ["list","load"] as const){
  expect(await createActivityController({owner:async()=>{throw new OwnerAccessError("unauthenticated");},reader})[method]("x")).toMatchObject({ok:false,code:"unauthenticated"});
  expect(await createActivityController({owner:async()=>owner,reader})[method]("x","old-account")).toMatchObject({ok:false,code:"session_changed"});
 }
 expect(reader).not.toHaveBeenCalled();
});
test("reader failures have fixed bounded messages",async()=>{
 for(const error of [new ActivityError("not_found"),new ActivityError("invalid_request"),new Error("private db url")]){
  const reader=()=>({list:async()=>{throw error;},load:async()=>{throw error;}});
  const result=await createActivityController({owner:async()=>owner,reader}).list();
  expect(result).toMatchObject({ok:false,code:error instanceof ActivityError?error.code:"unavailable"});expect(JSON.stringify(result)).not.toContain("private db url");
 }
});
test("saved list is account scoped and contains no execution authority",async()=>{
 const list=vi.fn(async()=>({items:[],nextCursor:null})),load=vi.fn();
 const result=await createActivityController({owner:async()=>owner,reader:()=>({list,load}),clock:()=>new Date("2026-11-25T12:00:00Z")}).list(undefined,owner.accountId);
 expect(list).toHaveBeenCalledWith(owner,undefined);expect(load).not.toHaveBeenCalled();
 expect(result).toMatchObject({ok:true,screen:{scope:owner.accountId,sample:false,data:{kind:"list",page:{items:[]}}}});
});
