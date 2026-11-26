import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {newSaleAccount,intents,wallet,prepared,admin,advance} from "../fixtures/disposal-database";
import {createDisposalPreparationService} from "../../src/features/orders/disposal-service.server";
test("one fixture preparation persists exact sale review and idempotent replay never repeats callbacks",async()=>{
 const d=await newSaleAccount();let wallets=0,preparations=0;
 const service=createDisposalPreparationService({source:"contract_fixture",...d,intents,wallet:async(_ctx,t)=>{wallets++;return wallet(t);},prepare:async(_ctx,t)=>{preparations++;return {kind:"prepared",...prepared(t)};}});
 const first=await service.prepare(d.owner,d.request),again=await service.prepare(d.owner,d.request);expect(first).toMatchObject({state:"REVIEW_READY",canApprove:false,canExecute:false});expect(again).toEqual(first);expect(wallets).toBe(1);expect(preparations).toBe(1);
});
test("a preparation timeout stays unknown and cannot create again through request replay",async()=>{
 const d=await newSaleAccount();let calls=0;const service=createDisposalPreparationService({source:"contract_fixture",...d,intents,wallet:async(_ctx,t)=>wallet(t),prepare:async()=>{calls++;throw new Error("fictional timeout");}});
 expect(await service.prepare(d.owner,d.request)).toMatchObject({state:"UNKNOWN",review:null});expect(await service.prepare(d.owner,d.request)).toMatchObject({state:"UNKNOWN"});expect(calls).toBe(1);
 expect((await admin.query("SELECT active_operation_id FROM harborline.gateway_accounts WHERE id=$1",[d.owner.accountId])).rows[0].active_operation_id).not.toBeNull();
});
test("provider mode stops before claim or any callback",async()=>{
 const d=await newSaleAccount(),callback=vi.fn();const service=createDisposalPreparationService({source:"provider",...d,intents,wallet:callback,prepare:callback});await expect(service.prepare(d.owner,d.request)).rejects.toMatchObject({code:"disabled"});expect(callback).not.toHaveBeenCalled();
 expect((await admin.query("SELECT active_operation_id FROM harborline.gateway_accounts WHERE id=$1",[d.owner.accountId])).rows[0].active_operation_id).toBeNull();
});
test("pausing writes during a preparation callback still persists possible effects and keeps the reservation",async()=>{
 const d=await newSaleAccount();const service=createDisposalPreparationService({source:"contract_fixture",...d,intents,wallet:async(_ctx,t)=>wallet(t),prepare:async()=>{d.disable();throw new Error("fixture late timeout");}});
 const result=await service.prepare(d.owner,d.request);expect(result).toMatchObject({state:"UNKNOWN"});expect((await intents.get(d.owner,result.intentId)).effectsPossible).toBe(true);
});

test.each(["2","0.000000001","184467440737.09551616"])("invalid base quantity %s never reaches preparation and safely releases",async requestedQty=>{
 const d=await newSaleAccount(),prepare=vi.fn(async(_ctx:unknown,t:Parameters<typeof prepared>[0])=>({kind:"prepared",...prepared(t)}));
 const service=createDisposalPreparationService({source:"contract_fixture",...d,intents,wallet:async(_ctx,t)=>wallet(t),prepare});
 await expect(service.prepare(d.owner,{...d.request,requestedQty})).rejects.toBeDefined();expect(prepare).not.toHaveBeenCalled();
 expect((await admin.query("SELECT active_operation_id FROM harborline.gateway_accounts WHERE id=$1",[d.owner.accountId])).rows[0].active_operation_id).toBeNull();
});
test("a durable preparation attempt survives abandonment, lease cleanup, restart and generic completion",async()=>{
 const d=await newSaleAccount();let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>{enter=r;}),gate=new Promise<void>(r=>{release=r;});
 const service=createDisposalPreparationService({source:"contract_fixture",...d,intents,wallet:async(_ctx,t)=>wallet(t),prepare:async()=>{enter();await gate;throw new Error("fictional suspended timeout");}}),running=service.prepare(d.owner,d.request);await entered;
 const [row]=(await admin.query("SELECT id FROM harborline.investment_intents WHERE account_id=$1",[d.owner.accountId])).rows;
 try{
  const before=await intents.get(d.owner,row.id);expect((await admin.query("SELECT id FROM harborline.audit_events WHERE intent_id=$1 AND event_type='sale_preparation_authorized'",[row.id])).rows).toHaveLength(1);
  await expect(intents.abandon(d.owner,row.id,before.revision)).rejects.toBeDefined();
  await expect(intents.rejectPreparation(d.owner,row.id,before.revision)).rejects.toBeDefined();
  await expect(d.reads.begin(d.owner,row.id,"prepare")).rejects.toBeDefined();
  const {createReviewRepository}=await import("../../src/features/orders/reviews.server"),{db,vault,clock}=await import("../fixtures/disposal-database");
  await expect(createReviewRepository(db,{clock,vault}).reject(d.owner,{intentId:row.id,expectedRevision:before.revision,generation:before.preparationGeneration})).rejects.toMatchObject({code:"integration_unverified"});advance(31000);
  expect(await intents.cleanup(d.owner,row.id,before.revision)).toMatchObject({state:"PREPARING"});
  await expect(intents.beginPreparation(d.owner,row.id,before.revision)).rejects.toBeDefined();
  await expect(intents.finishPreparation(d.owner,{id:row.id,expectedRevision:before.revision,generation:before.preparationGeneration,providerOrderId:"fake-finish",reviewExpiresAt:new Date(Date.parse(before.updatedAt)+50000).toISOString()})).rejects.toBeDefined();
  await expect(intents.claim(d.owner,{...d.request,requestKey:"competing-preparation"})).rejects.toMatchObject({code:"operation_in_progress"});
 }finally{release();await running;}
 expect(await intents.get(d.owner,row.id)).toMatchObject({state:"UNKNOWN",effectsPossible:true});
 expect((await admin.query("SELECT active_operation_id FROM harborline.gateway_accounts WHERE id=$1",[d.owner.accountId])).rows[0].active_operation_id).toBe(row.id);
});
test("an exact definitive fixture rejection completes only its own preparation fence",async()=>{
 const d=await newSaleAccount(),service=createDisposalPreparationService({source:"contract_fixture",...d,intents,wallet:async(_ctx,t)=>wallet(t),prepare:async()=>({kind:"rejected"})});
 expect(await service.prepare(d.owner,d.request)).toMatchObject({state:"REJECTED"});expect((await admin.query("SELECT active_operation_id FROM harborline.gateway_accounts WHERE id=$1",[d.owner.accountId])).rows[0].active_operation_id).toBeNull();
});
