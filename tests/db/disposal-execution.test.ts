import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import type {ExecutionPort} from "../../src/features/orders/execution-types";
import {admin,intents,advance,reviewedSale,approvalRead,wallet,vault} from "../fixtures/disposal-database";
import {createDisposalExecutionRepository,createDisposalExecutionPort} from "../../src/features/orders/disposal-execution.server";
import {createFixtureExecutionService} from "../../src/features/orders/execute.server";
import {createOrderExecutionAdapter} from "../../src/integrations/truemarkets/execution.server";
import {createEncryptedSigner} from "../../src/features/accounts/key-store.server";
import {stampEncryptedSigner} from "../../src/features/accounts/signer.server";
async function approved(){const d=await reviewedSale(),r=await approvalRead(d);await d.approvals.approve(d.owner,d.command,{readId:r.id});return {...d,execution:createDisposalExecutionRepository(d.store)};}
test("concurrent sale dispatch claims return one durable work item",async()=>{
 const d=await approved(),results=await Promise.all(Array.from({length:12},()=>d.execution.claim(d.owner,d.command)));expect(results.filter(Boolean)).toHaveLength(1);
 expect(results.find(Boolean)).toMatchObject({intentId:d.intentId,binding:{operationKind:"sell"},payloadHashes:d.review.terms.review.quote.payloadDigests});
});
async function harness(onSend:()=>Promise<unknown>,onSign?:()=>void,onFinish?:(finish:ExecutionPort["finish"])=>ExecutionPort["finish"]){
 const d=await approved(),key=Buffer.alloc(32,6),signer=createEncryptedSigner(d.owner.accountId,key,1);await admin.query("UPDATE harborline.gateway_accounts SET public_key=$2 WHERE id=$1",[d.owner.accountId,signer.publicKey]);
 let signs=0,reads=0;const port=createDisposalExecutionPort(d.execution,d.reads,async(_ctx,t)=>{reads++;return wallet(t);});
 const service=createFixtureExecutionService({source:"contract_fixture",execution:{...port,finish:onFinish?onFinish(port.finish):port.finish},vault,signer:{async stamp(ctx,publicKey,payloads){signs++;onSign?.();return stampEncryptedSigner(ctx.accountId,signer,new Map([[1,key]]),publicKey,payloads);}},adapter:createOrderExecutionAdapter({async request(){return onSend();}})});
 return {...d,service,signs:()=>signs,readCount:()=>reads};
}
test("shared execution protocol signs and sends a sale once after durable authorization",async()=>{
 let sends=0;const d=await harness(async()=>{sends++;return {status:"complete"};});
 await Promise.all(Array.from({length:10},()=>d.service.execute(d.owner,d.command)));
 expect(sends).toBe(1);expect(d.signs()).toBe(1);expect(d.readCount()).toBe(2);expect((await intents.get(d.owner,d.intentId)).state).toBe("COMPLETE");
 expect((await admin.query("SELECT * FROM harborline.disposal_send_authorizations WHERE intent_id=$1",[d.intentId])).rows).toHaveLength(1);
});
test("expiry during signing prevents a sale send and retains uncertainty",async()=>{
 let sends=0;const d=await harness(async()=>{sends++;return {status:"complete"};},()=>advance(20000));
 await d.service.execute(d.owner,d.command);expect(sends).toBe(0);expect((await intents.get(d.owner,d.intentId)).state).toBe("UNKNOWN");
 await d.service.execute(d.owner,d.command);expect(sends).toBe(0);expect(d.signs()).toBe(1);
});
test("original dispatch timeout never causes a resend",async()=>{
 let sends=0;const d=await harness(async()=>{sends++;throw new Error("fixture timeout");});await d.service.execute(d.owner,d.command);await d.service.execute(d.owner,d.command);
 expect(sends).toBe(1);expect((await intents.get(d.owner,d.intentId)).state).toBe("UNKNOWN");
});

test("a failed write of a known conflicting POST never fabricates an unknown completion or resends",async()=>{
 const {createDisposalRecovery}=await import("../../src/features/orders/disposal-recovery.server"),{assets}=await import("../fixtures/disposal-database");let sends=0,fail=true;
 const d:Awaited<ReturnType<typeof harness>>=await harness(async()=>{
  sends++;const read=await d.reads.begin(d.owner,d.intentId,"order");await createDisposalRecovery(d.store).record(d.owner,read.id,{source:"contract_fixture",kind:"response",body:{order_id:d.review.terms.review.quote.providerOrderId,asset_id:assets.stock.id,qty:"0.5",qty_unit:"base",side:"sell",type:"market",chain:"solana",venue:"defi",quote_asset:"USDC",fee_asset:assets.cash.id,status:"complete",executed_qty:"0.5",leaves_qty:"0",executed_vwap:"200",fee:"0.5"}});return {status:"failed"};
 },undefined,finish=>async(...args)=>{if(args[3]==="failed"&&fail){fail=false;throw new Error("fictional write failure");}return finish(...args);});
 await expect(d.service.execute(d.owner,d.command)).rejects.toMatchObject({code:"unavailable"});
 expect((await admin.query("SELECT id FROM harborline.audit_events WHERE intent_id=$1 AND event_type='execution_observed'",[d.intentId])).rows).toEqual([]);
 await expect(d.reads.begin(d.owner,d.intentId,"settlement")).rejects.toBeDefined();await d.service.execute(d.owner,d.command);expect(sends).toBe(1);
 const [approval]=(await admin.query("SELECT attempt_id FROM harborline.disposal_approvals WHERE intent_id=$1",[d.intentId])).rows;await d.execution.finish(d.owner,d.command,approval.attempt_id,"failed");expect(await createDisposalRecovery(d.store).current(d.owner,d.intentId)).toMatchObject({requiresManualReview:true,slotHeld:true});
});
