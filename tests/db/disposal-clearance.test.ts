import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {randomUUID} from "node:crypto";
import {admin,clock,intents,advance,reviewedSale,approvalRead,wallet,assets} from "../fixtures/disposal-database";
import {createDisposalExecutionRepository} from "../../src/features/orders/disposal-execution.server";
import {createDisposalRecovery} from "../../src/features/orders/disposal-recovery.server";
import {createDisposalSettlement} from "../../src/features/orders/disposal-settlement.server";
async function finished(status="complete",filled="0.5",fee="0.5",finishOriginal=true){
 const d=await reviewedSale();advance(1000);const a=await approvalRead(d);await d.approvals.approve(d.owner,d.command,{readId:a.id});const execution=createDisposalExecutionRepository(d.store),work=await execution.claim(d.owner,d.command);if(!work)throw new Error("fixture dispatch");
 const send=await d.reads.begin(d.owner,d.intentId,"send");await d.reads.record(d.owner,send.id,wallet(send));await execution.checkSend(d.owner,d.command,work.attemptId,send.id,true);if(finishOriginal)await execution.finish(d.owner,d.command,work.attemptId,status as "complete"|"failed"|"canceled");
 const recovery=createDisposalRecovery(d.store),read=await d.reads.begin(d.owner,d.intentId,"order"),remaining=filled==="0.5"?"0":"0.3";
 await recovery.record(d.owner,read.id,{source:"contract_fixture",kind:"response",body:{order_id:d.review.terms.review.quote.providerOrderId,asset_id:assets.stock.id,qty:"0.5",qty_unit:"base",side:"sell",type:"market",chain:"solana",venue:"defi",quote_asset:"USDC",fee_asset:assets.cash.id,status,executed_qty:filled,leaves_qty:remaining,executed_vwap:"200",fee}});
 return {...d,execution,work,recovery,orderReadId:read.id,settlement:createDisposalSettlement(d.store)};
}
async function capture(d:Awaited<ReturnType<typeof finished>>,stock="0.5",cash="99.5"){
 const t=await d.reads.begin(d.owner,d.intentId,"settlement");await d.reads.record(d.owner,t.id,wallet(t,stock,cash));
 return {intentId:d.intentId,walletReadId:t.id,requestKey:randomUUID(),otherBaseCredits:"0",otherBaseDebits:"0",otherQuoteCredits:"0",otherQuoteDebits:"0",references:{order:"fixture:"+d.review.terms.review.quote.providerOrderId,balance:"fixture:"+t.id,stock:"fixture:"+t.id,wallet:"fixture:wallet"}};
}
test("complete sale clears only after independent stock/cash proof, then replay cannot release a newer operation",async()=>{
 const d=await finished(),input=await capture(d);expect(await d.settlement.clear(d.owner,input)).toMatchObject({verified:true,released:true,result:{actualBaseDebit:"0.5",actualNetQuoteCredit:"99.5",stockTotalAfter:"0.5",cashAfter:"99.5"}});
 const next=await intents.claim(d.owner,{...d.request,requestKey:randomUUID()});expect(await d.settlement.clear(d.owner,input)).toMatchObject({replayed:true,released:false});
 expect((await admin.query("SELECT active_operation_id FROM harborline.gateway_accounts WHERE id=$1",[d.owner.accountId])).rows[0].active_operation_id).toBe(next.intent.id);
});
test("a partial failed sale credits actual proceeds without claiming no assets moved",async()=>{
 const d=await finished("failed","0.2","0.2"),input=await capture(d,"0.8","39.8");expect(await d.settlement.clear(d.owner,input)).toMatchObject({result:{partial:true,actualBaseDebit:"0.2",actualNetQuoteCredit:"39.8"},released:true});
});
test("an unrelated latest cash snapshot arriving after the capture invalidates clearance",async()=>{
 const d=await finished(),input=await capture(d);await admin.query("INSERT INTO harborline.balance_snapshots(account_id,source,listing_id,chain,venue,available,observed_at) VALUES($1,'fixture',$2,'solana','defi','500', $3)",[d.owner.accountId,assets.cash.id,clock()]);
 await expect(d.settlement.clear(d.owner,input)).rejects.toBeDefined();expect((await d.recovery.current(d.owner,d.intentId)).slotHeld).toBe(true);
});
test("wrong stock/cash proof, owner, operator or altered replay cannot clear the slot",async()=>{
 const d=await finished(),other=await finished(),bad=await capture(d,"0.6","99.5");await expect(d.settlement.clear(d.owner,bad)).rejects.toBeDefined();
 const input=await capture(d);await expect(d.settlement.clear(other.owner,input)).rejects.toMatchObject({code:"not_found"});d.revoke();await expect(d.settlement.clear(d.owner,input)).rejects.toMatchObject({code:"disabled"});
 expect((await admin.query("SELECT * FROM harborline.disposal_settlements WHERE intent_id=$1",[d.intentId])).rows).toEqual([]);
});
test("a new order check invalidates the captured proof until fresh matching evidence is collected",async()=>{
 const d=await finished(),input=await capture(d),later=await d.reads.begin(d.owner,d.intentId,"order");await d.recovery.record(d.owner,later.id,{source:"contract_fixture",kind:"unavailable"});await expect(d.settlement.clear(d.owner,input)).rejects.toBeDefined();
});
test("a suppressed clearance audit rolls back baseline, verification and release atomically",async()=>{
 const d=await finished(),input=await capture(d),before=(await admin.query("SELECT count(*) AS n FROM harborline.balance_snapshots WHERE account_id=$1",[d.owner.accountId])).rows[0].n;
 await admin.query("CREATE FUNCTION harborline.suppress_sale_clear_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='sale_settlement_verified' THEN RETURN NULL; END IF; RETURN NEW; END $$; CREATE TRIGGER suppress_sale_clear_audit BEFORE INSERT ON harborline.audit_events FOR EACH ROW EXECUTE FUNCTION harborline.suppress_sale_clear_audit()");
 try{await expect(d.settlement.clear(d.owner,input)).rejects.toBeDefined();}finally{await admin.query("DROP TRIGGER suppress_sale_clear_audit ON harborline.audit_events;DROP FUNCTION harborline.suppress_sale_clear_audit()");}
 expect((await admin.query("SELECT * FROM harborline.disposal_settlements WHERE intent_id=$1",[d.intentId])).rows).toEqual([]);expect((await admin.query("SELECT count(*) AS n FROM harborline.balance_snapshots WHERE account_id=$1",[d.owner.accountId])).rows[0].n).toBe(before);expect((await d.recovery.current(d.owner,d.intentId)).slotHeld).toBe(true);
});

test("terminal GET evidence cannot clear before the original send callback is durably recorded",async()=>{
 const d=await finished("complete","0.5","0.5",false);await expect(d.reads.begin(d.owner,d.intentId,"settlement")).rejects.toBeDefined();
 await d.execution.finish(d.owner,d.command,d.work.attemptId,"complete");const input=await capture(d);expect(await d.settlement.clear(d.owner,input)).toMatchObject({released:true});
});
test("receipt replay drops unexpected private fields from a persisted proof",async()=>{
 const d=await finished(),input=await capture(d);await d.settlement.clear(d.owner,input);
 await admin.query("UPDATE harborline.disposal_settlements SET result=result||$2::jsonb WHERE intent_id=$1",[d.intentId,JSON.stringify({private_key:"PRIVATE_PROOF_MARKER",operatorId:"PRIVATE_PROOF_MARKER"})]);
 expect(JSON.stringify(await d.settlement.clear(d.owner,input))).not.toContain("PRIVATE_PROOF_MARKER");
});

// The same owner-only reader serves activity, receipts and the saved review page.
test("sale activity projects review and actual credit without buy approval semantics",async()=>{
 const {createActivityReader}=await import("../../src/features/orders/activity-reader.server");
 const {db}=await import("../fixtures/disposal-database");
 const d=await finished(),reader=createActivityReader(db,clock),view=await reader.load(d.owner,d.intentId);
 expect(view).toMatchObject({operationKind:"sell",approval:null,settlement:null,sale:{review:{requestedBase:"0.5",expectedNetQuote:"99.5"},approval:{cashBefore:"0",stockBefore:"1"},actualGrossQuote:"100",actualNetQuote:"99.5",settlement:null}});
 expect((await reader.list(d.owner)).items[0]).toMatchObject({operationKind:"sell",settlementVerified:false});
 expect(JSON.stringify(view)).not.toMatch(/providerUserId|holdingReadId|operatorId|sealed|ciphertext/);
});
test("verified sale receipt survives a new plan, cash baseline, operation and stale wall clock",async()=>{
 const {createActivityReader}=await import("../../src/features/orders/activity-reader.server"),{db}=await import("../fixtures/disposal-database");
 const d=await finished(),input=await capture(d);await d.settlement.clear(d.owner,input);const reader=createActivityReader(db,clock),before=await reader.load(d.owner,d.intentId);
 expect(before).toMatchObject({settlementVerified:true,reservationHeld:false,sale:{settlement:{actualNetQuoteCredit:"99.5",stockTotalBefore:"1",stockTotalAfter:"0.5",cashAfter:"99.5"}}});
 await admin.query("UPDATE harborline.gateway_accounts SET policy_revision=policy_revision+1 WHERE id=$1",[d.owner.accountId]);
 await admin.query("INSERT INTO harborline.balance_snapshots(account_id,source,listing_id,chain,venue,available,observed_at) VALUES($1,'fixture',$2,'solana','defi','9000',$3)",[d.owner.accountId,assets.cash.id,clock()]);advance(86400000);
 const after=await reader.load(d.owner,d.intentId);expect(after.sale).toEqual(before.sale);
 const other=await reviewedSale();await expect(reader.load(other.owner,d.intentId)).rejects.toMatchObject({code:"not_found"});
});
test("historical receipt rejects a mismatched immutable economic result",async()=>{
 const {createActivityReader}=await import("../../src/features/orders/activity-reader.server"),{db}=await import("../fixtures/disposal-database");const d=await finished(),input=await capture(d);await d.settlement.clear(d.owner,input);
 await admin.query("UPDATE harborline.disposal_settlements SET result=jsonb_set(result,'{actualNetQuoteCredit}','\"999\"') WHERE intent_id=$1",[d.intentId]);
 await expect(createActivityReader(db,clock).load(d.owner,d.intentId)).rejects.toMatchObject({code:"unavailable"});
});
