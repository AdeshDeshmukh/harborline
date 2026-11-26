import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {admin,intents,advance,setupSale,reviewedSale,approvalRead,wallet,prepared} from "../fixtures/disposal-database";
test("base-sized sale review and explicit approval persist with zero cash and no allowance calculation",async()=>{
 const d=await reviewedSale(),ticket=await approvalRead(d),r=await d.approvals.approve(d.owner,d.command,{readId:ticket.id});
 expect(r).toMatchObject({accepted:true,state:"SUBMITTING",source:"contract_fixture",canExecute:false});expect((await d.reviews.get(d.owner,d.intentId))?.terms.review.expectedNetQuote).toBe("99.5");
 expect((await admin.query("SELECT b.available FROM harborline.disposal_approvals a JOIN harborline.balance_snapshots b ON b.id=a.cash_baseline_id WHERE a.intent_id=$1",[d.intentId])).rows[0].available).toMatch(/^0(?:\.0+)?$/);
});
test("later wallet read wins even if an older response finishes afterwards",async()=>{
 const d=await setupSale(),older=await d.reads.begin(d.owner,d.intentId,"prepare");advance(1);const newer=await d.reads.begin(d.owner,d.intentId,"prepare");
 expect(await d.reads.record(d.owner,newer.id,wallet(newer))).toMatchObject({accepted:true});expect(await d.reads.record(d.owner,older.id,wallet(older))).toMatchObject({accepted:false});
 await expect(d.reviews.record(d.owner,{readId:older.id,...prepared(older)})).rejects.toBeDefined();
});
test("another owner or revoked operator cannot review or approve the sale",async()=>{
 const d=await reviewedSale(),other=await setupSale(),ticket=await approvalRead(d);
 await expect(d.reads.begin(other.owner,d.intentId,"approval")).rejects.toMatchObject({code:"not_found"});
 await expect(d.approvals.approve(other.owner,d.command,{readId:ticket.id})).rejects.toMatchObject({code:"not_found"});
 d.revoke();await expect(d.approvals.approve(d.owner,d.command,{readId:ticket.id})).rejects.toMatchObject({code:"disabled"});
 expect((await admin.query("SELECT * FROM harborline.disposal_approvals WHERE intent_id=$1",[d.intentId])).rows).toEqual([]);
});
test("stale holdings or altered approved hash cannot enter submitting",async()=>{
 const d=await reviewedSale(),ticket=await approvalRead(d);
 await expect(d.approvals.approve(d.owner,{...d.command,termsHash:"f".repeat(64)},{readId:ticket.id})).rejects.toBeDefined();advance(16000);
 await expect(d.approvals.approve(d.owner,d.command,{readId:ticket.id})).rejects.toBeDefined();expect((await intents.get(d.owner,d.intentId)).state).toBe("REVIEW_READY");
});
test("a sale and buy cannot claim the account concurrently; approval replay creates no attempt",async()=>{
 const d=await reviewedSale(),ticket=await approvalRead(d),first=await d.approvals.approve(d.owner,d.command,{readId:ticket.id});
 expect(await d.approvals.approve(d.owner,d.command,{readId:ticket.id})).toMatchObject({accepted:false,attemptId:first.attemptId});
 await expect(intents.claim(d.owner,{...d.request,requestKey:"competing",operationKind:"buy",qtyUnit:"quote",calculationId:d.intentId})).rejects.toMatchObject({code:"operation_in_progress"});
 expect((await admin.query("SELECT * FROM harborline.disposal_approvals WHERE intent_id=$1",[d.intentId])).rows).toHaveLength(1);
});
test("a suppressed approval audit rolls back approval, fresh cash snapshot and state",async()=>{
 const d=await reviewedSale(),ticket=await approvalRead(d),before=(await admin.query("SELECT count(*) AS n FROM harborline.balance_snapshots WHERE account_id=$1",[d.owner.accountId])).rows[0].n;
 await admin.query("CREATE FUNCTION harborline.suppress_sale_approval_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='sale_approved' THEN RETURN NULL; END IF; RETURN NEW; END $$; CREATE TRIGGER suppress_sale_approval_audit BEFORE INSERT ON harborline.audit_events FOR EACH ROW EXECUTE FUNCTION harborline.suppress_sale_approval_audit()");
 try{await expect(d.approvals.approve(d.owner,d.command,{readId:ticket.id})).rejects.toBeDefined();}finally{await admin.query("DROP TRIGGER suppress_sale_approval_audit ON harborline.audit_events; DROP FUNCTION harborline.suppress_sale_approval_audit()");}
 expect((await intents.get(d.owner,d.intentId)).state).toBe("REVIEW_READY");expect((await admin.query("SELECT * FROM harborline.disposal_approvals WHERE intent_id=$1",[d.intentId])).rows).toEqual([]);expect((await admin.query("SELECT count(*) AS n FROM harborline.balance_snapshots WHERE account_id=$1",[d.owner.accountId])).rows[0].n).toBe(before);
});
