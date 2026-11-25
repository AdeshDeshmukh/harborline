import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {createReviewScreenController} from "../src/features/orders/screen.server";
import {OwnerAccessError,type OwnerContext} from "../src/features/identity/access.server";
import {ReviewError} from "../src/features/orders/review-types";
const context={ownerId:"11111111-1111-4111-8111-111111111111",accountId:"22222222-2222-4222-8222-222222222222"} as OwnerContext;
test("an ended session and changed account cannot load old review terms",async()=>{
  const reader=vi.fn(()=>({load:vi.fn()}));
  expect(await createReviewScreenController({owner:async()=>{throw new OwnerAccessError("unauthenticated");},reader}).load(context.ownerId)).toMatchObject({ok:false,code:"unauthenticated"});
  expect(await createReviewScreenController({owner:async()=>context,reader}).load(context.ownerId,"other-account")).toMatchObject({ok:false,code:"session_changed"});expect(reader).not.toHaveBeenCalled();
});
test("unknown owned reviews and private failures have bounded user-facing errors",async()=>{
  for(const [error,code] of [[new ReviewError("not_found"),"not_found"],[new Error("postgresql://private-credential SQL detail"),"unavailable"]] as const){
    const result=await createReviewScreenController({owner:async()=>context,reader:()=>({load:async()=>{throw error;}})}).load(context.ownerId,context.accountId);
    expect(result).toMatchObject({ok:false,code});expect(JSON.stringify(result)).not.toContain("private-credential");
  }
});
