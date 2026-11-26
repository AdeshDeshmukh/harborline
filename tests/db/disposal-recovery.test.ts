import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {admin,clock,advance,reviewedSale,approvalRead,assets,wallet} from "../fixtures/disposal-database";
import {createDisposalExecutionRepository} from "../../src/features/orders/disposal-execution.server";
import {createDisposalRecovery} from "../../src/features/orders/disposal-recovery.server";
async function submitted(){const d=await reviewedSale(),ticket=await approvalRead(d);await d.approvals.approve(d.owner,d.command,{readId:ticket.id});const execution=createDisposalExecutionRepository(d.store),work=await execution.claim(d.owner,d.command);if(!work)throw new Error("fixture dispatch");const send=await d.reads.begin(d.owner,d.intentId,"send");await d.reads.record(d.owner,send.id,wallet(send));await execution.checkSend(d.owner,d.command,work.attemptId,send.id,true);await execution.finish(d.owner,d.command,work.attemptId,"pending");return {...d,execution,work,recovery:createDisposalRecovery(d.store)};}
function order(d:Awaited<ReturnType<typeof submitted>>,change:Record<string,unknown>={}){return {source:"contract_fixture",kind:"response",body:{order_id:d.review.terms.review.quote.providerOrderId,asset_id:assets.stock.id,qty:"0.5",qty_unit:"base",side:"sell",type:"market",chain:"solana",venue:"defi",quote_asset:"USDC",fee_asset:assets.cash.id,status:"complete",executed_qty:"0.5",leaves_qty:"0",executed_vwap:"200",fee:"0.5",...change}};}
test("accepted sale fills survive a later-recorded ignored read without restamping actual evidence",async()=>{
 const d=await submitted(),older=await d.reads.begin(d.owner,d.intentId,"order");advance(1);const newer=await d.reads.begin(d.owner,d.intentId,"order");advance(1);
 const acceptedAt=clock().toISOString();expect(await d.recovery.record(d.owner,newer.id,order(d))).toMatchObject({state:"COMPLETE",evidence:{grossQuote:"100"},actualRecordedAt:acceptedAt,slotHeld:true,settlementVerified:false});advance(1000);
 expect(await d.recovery.record(d.owner,older.id,{source:"contract_fixture",kind:"unavailable"})).toMatchObject({state:"COMPLETE",actualRecordedAt:acceptedAt,latest:{kind:"unavailable",disposition:"ignored",observedAt:clock().toISOString()}});
});
test("contradictory terminal sale reports keep the original outcome and a manual review requirement",async()=>{
 const d=await submitted(),first=await d.reads.begin(d.owner,d.intentId,"order");await d.recovery.record(d.owner,first.id,order(d));const next=await d.reads.begin(d.owner,d.intentId,"order");
 expect(await d.recovery.record(d.owner,next.id,order(d,{status:"failed"}))).toMatchObject({state:"COMPLETE",requiresManualReview:true,evidence:{providerStatus:"complete"},latest:{disposition:"conflict"}});
});
test("a late original POST cannot regress a terminal GET outcome",async()=>{
 const d=await submitted(),ticket=await d.reads.begin(d.owner,d.intentId,"order");await d.recovery.record(d.owner,ticket.id,order(d));await d.execution.finish(d.owner,d.command,d.work.attemptId,"failed");
 expect(await d.recovery.current(d.owner,d.intentId)).toMatchObject({state:"COMPLETE",requiresManualReview:true});
});
test("missing actual fees or price remain unknown rather than substituting the sale quote",async()=>{
 const d=await submitted(),t=await d.reads.begin(d.owner,d.intentId,"order");
 expect(await d.recovery.record(d.owner,t.id,order(d,{fee:null,executed_vwap:null}))).toMatchObject({state:"COMPLETE",evidence:{feeQuote:null,averagePriceQuote:null,grossQuote:null}});
});
test("wrong-owner order responses and changed replay bodies cannot replace stored evidence",async()=>{
 const d=await submitted(),other=await submitted(),t=await d.reads.begin(d.owner,d.intentId,"order");
 await expect(d.recovery.record(other.owner,t.id,order(d))).rejects.toMatchObject({code:"not_found"});
 await d.recovery.record(d.owner,t.id,order(d));await expect(d.recovery.record(d.owner,t.id,{source:"contract_fixture",kind:"not_found"})).rejects.toBeDefined();
 expect((await admin.query("SELECT * FROM harborline.disposal_outcomes WHERE read_id=$1",[t.id])).rows).toHaveLength(1);
});
test("pausing new writes still permits an authorized read-only investigation",async()=>{
 const d=await submitted();d.disable();const t=await d.reads.begin(d.owner,d.intentId,"order");
 expect(await d.recovery.record(d.owner,t.id,order(d))).toMatchObject({state:"COMPLETE",slotHeld:true});
});

test("known terminal VWAP and proceeds cannot be silently revised upward",async()=>{
 const d=await submitted(),first=await d.reads.begin(d.owner,d.intentId,"order");await d.recovery.record(d.owner,first.id,order(d));const next=await d.reads.begin(d.owner,d.intentId,"order");
 expect(await d.recovery.record(d.owner,next.id,order(d,{executed_vwap:"202"}))).toMatchObject({requiresManualReview:true,evidence:{averagePriceQuote:"200",grossQuote:"100"},latest:{disposition:"conflict"}});
 await expect(d.reads.begin(d.owner,d.intentId,"settlement")).rejects.toBeDefined();
});
test("missing terminal fee may become known without contradicting established actuals",async()=>{
 const d=await submitted(),first=await d.reads.begin(d.owner,d.intentId,"order");await d.recovery.record(d.owner,first.id,order(d,{fee:null}));const next=await d.reads.begin(d.owner,d.intentId,"order");
 expect(await d.recovery.record(d.owner,next.id,order(d))).toMatchObject({requiresManualReview:false,evidence:{feeQuote:"0.5",grossQuote:"100"},latest:{disposition:"applied"}});
});
test("fee above known gross becomes conflicting evidence while the saved receipt remains readable",async()=>{
 const {db}=await import("../fixtures/disposal-database"),{createActivityReader}=await import("../../src/features/orders/activity-reader.server");
 const d=await submitted(),t=await d.reads.begin(d.owner,d.intentId,"order");
 expect(await d.recovery.record(d.owner,t.id,order(d,{status:"failed",executed_qty:"0.2",leaves_qty:"0.3",executed_vwap:"5",fee:"2"}))).toMatchObject({requiresManualReview:true,latest:{kind:"invalid_response",disposition:"conflict"}});
 expect(await createActivityReader(db,clock).load(d.owner,d.intentId)).toMatchObject({requiresReview:true,sale:{review:{requestedBase:"0.5"},approval:{cashBefore:"0"},actualNetQuote:null}});
});
