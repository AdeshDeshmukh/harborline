import {randomUUID} from "node:crypto";
import {expect,test} from "vitest";
import {admin,db,clock,approved,completed,setup,recovery,intents,advance,order,responseOf} from "../fixtures/order-database";
import {createActivityReader} from "../../src/features/orders/activity-reader.server";
import {createSettlementRepository} from "../../src/features/orders/settlement-repository.server";
import {SOLANA_USDC_MINT} from "../../src/integrations/truemarkets/read-types";
const reader=createActivityReader(db,clock);
async function verified(after="1899.5",credits="0",debits="0"){const d=await completed(),operatorId=randomUUID(),settlement=createSettlementRepository(db,{clock,fixtureMode:true,fixtureClearanceEnabled:true,operatorId,allowedOperatorIds:[operatorId]}),basis=await settlement.beginBalanceRead(d.owner,d.command.intentId);
 const observation=await settlement.recordBalance(d.owner,basis,{source:"contract_fixture",observedAt:basis.balanceStartedAt,body:{data:[{asset_id:basis.cashId,address:SOLANA_USDC_MINT,chain:"solana",venue:"defi",decimals:6,symbol:"USDC",stable:true,tradeable:false,available:after,total:after,held:"0"}]}});
 await settlement.clear(d.owner,{intentId:d.command.intentId,observationId:observation.id,requestKey:randomUUID(),actualDebit:"100.5",interveningCredits:credits,interveningDebits:debits,references:{order:"fixture:"+d.review.providerOrderId,wallet:"fixture:wallet",balance:"fixture:"+observation.id,activity:"fixture:activity"}});return d;
}
test("a fresh reader returns persisted uncertainty and the original approved plan",async()=>{
 const d=await approved();await intents.advance(d.owner,d.command.intentId,4,"UNKNOWN");advance(86400000);
 expect(await createActivityReader(db,clock).load(d.owner,d.command.intentId)).toMatchObject({id:d.command.intentId,state:"UNKNOWN",source:"contract_fixture",reservationHeld:true,settlementVerified:false,actual:null,approval:{planningRevision:2,maximumDebit:"100.5",cashBefore:"2000"},chainReference:null});
});
test("another owner cannot load an order or use its pagination cursor",async()=>{
 const d=await approved(),other=await setup();await expect(reader.load(other.owner,d.command.intentId)).rejects.toMatchObject({code:"not_found"});
 const page=await reader.list(other.owner);expect(page.items).toHaveLength(1);expect(page.items.every(r=>r.id!==d.command.intentId)).toBe(true);
});
test("a later failed check cannot re-date accepted fill evidence or substitute quote estimates",async()=>{
 const d=await completed(),at=clock().toISOString();advance(5000);const ticket=await recovery.begin(d.owner,d.command.intentId);await recovery.record(d.owner,ticket.id,{source:"contract_fixture",kind:"unavailable"});
 const record=await reader.load(d.owner,d.command.intentId);expect(record).toMatchObject({state:"COMPLETE",settlementVerified:false,reservationHeld:true,actual:{filledBase:"0.5",feeQuote:"0.5",recordedAt:at},latestCheck:{kind:"unavailable",at:clock().toISOString()}});
});
test("historical proof-linked cash remains unchanged after the next plan and balance",async()=>{
 const d=await verified();const before=await reader.load(d.owner,d.command.intentId);
 const {createPlanningService}=await import("../../src/features/planning/service.server"),{createPlanningRepository}=await import("../../src/features/planning/repository.server"),{createCalculationStore}=await import("../../src/features/planning/snapshots.server");
 await createPlanningService(createPlanningRepository(db)).savePolicy(d.owner,{expectedRevision:2,horizonDays:60,additionalBuffer:"200",acknowledged:true});
 await createCalculationStore(db,clock).recordFixtureBalance(d.owner,{listingId:d.review.quote.cashId,chain:"solana",venue:"defi",available:"3000"});
 expect((await reader.load(d.owner,d.command.intentId)).settlement).toEqual(before.settlement);
 expect(before).toMatchObject({settlementVerified:true,reservationHeld:false,approval:{planningRevision:2},settlement:{cashBefore:"2000",cashAfter:"1899.5",actualDebit:"100.5",method:"manual"}});
});
test("missing actual quantities remain null and raw private metadata/URLs are never projected",async()=>{
 const d=await approved(),ticket=await recovery.begin(d.owner,d.command.intentId);await recovery.record(d.owner,ticket.id,responseOf(order(d,{status:"complete",executed_qty:null,leaves_qty:"0",fee:null,executed_vwap:null})));
 await admin.query("UPDATE harborline.order_recovery_observations SET evidence=evidence||$2::jsonb WHERE read_id=$1",[ticket.id,JSON.stringify({private_key:"PRIVATE_MARKER",explorer_url:"javascript:PRIVATE_MARKER",payloads:["PRIVATE_MARKER"]})]);
 const record=await reader.load(d.owner,d.command.intentId);expect(record.actual).toMatchObject({filledBase:null,feeQuote:null});expect(record.chainReference).toBeNull();expect(JSON.stringify(record)).not.toMatch(/PRIVATE_MARKER|ciphertext|nonce|payload|providerUserId|operatorId/);
});
test("pagination preserves exact timestamp ties and refuses another account's cursor",async()=>{
 const d=await setup(),ids:string[]=[];
 for(let n=0;n<25;n++){const id=randomUUID();ids.push(id);await admin.query("INSERT INTO harborline.investment_intents(id,account_id,operation_kind,asset_id,requested_qty,qty_unit,request_key,request_hash,policy_revision,preparation_safety,calculation_id,created_at,updated_at) VALUES($1,$2,'buy',$3,'100','quote',$4,$5,2,'contract_fixture',$6,'2026-11-25T12:00:00.123456Z','2026-11-25T12:00:00.123456Z')",[id,d.owner.accountId,d.request.assetId,randomUUID(),"a".repeat(64),d.request.calculationId]);}
 const first=await reader.list(d.owner),second=await reader.list(d.owner,first.nextCursor!);expect(first.items).toHaveLength(20);expect(second.items).toHaveLength(6);expect([...first.items,...second.items].map(r=>r.id).filter(id=>ids.includes(id))).toEqual(ids.sort().reverse());
 const other=await setup();await expect(reader.list(other.owner,first.nextCursor!)).rejects.toMatchObject({code:"invalid_request"});
});
test("a conflicting later report stays visible in list and detail without replacing accepted fills",async()=>{
 const d=await completed(),ticket=await recovery.begin(d.owner,d.command.intentId);await recovery.record(d.owner,ticket.id,responseOf(order(d,{status:"failed",executed_qty:"0.5",leaves_qty:"0",fee:"0.5"})));
 const record=await reader.load(d.owner,d.command.intentId);expect(record).toMatchObject({requiresReview:true,actual:{providerStatus:"complete",filledBase:"0.5"},latestCheck:{disposition:"conflict"}});
 expect((await reader.list(d.owner)).items.find(r=>r.id===d.command.intentId)).toMatchObject({requiresReview:true,settlementVerified:false});
});
test("malformed and noncanonical cursors reject before any account query",async()=>{
 const d=await setup();
 const value={v:1,accountId:d.owner.accountId,at:"2026-11-25T12:00:00.123456Z",id:d.command.intentId};
 for(const c of ["", "a".repeat(513),"%",Buffer.from(JSON.stringify({...value,owner:"injected"})).toString("base64url"),Buffer.from(JSON.stringify({...value,at:"2026-02-31T12:00:00.123456Z"})).toString("base64url"),Buffer.from(JSON.stringify(value)).toString("base64url")+"="]){await expect(reader.list(d.owner,c)).rejects.toMatchObject({code:"invalid_request"});}
});
test("corrupt approved terms reject with a bounded error instead of rendering estimates",async()=>{
 const d=await approved();await admin.query("UPDATE harborline.order_reviews SET terms_hash=$2 WHERE intent_id=$1",[d.command.intentId,"b".repeat(64)]);
 await expect(reader.load(d.owner,d.command.intentId)).rejects.toMatchObject({code:"unavailable",message:"Saved order records are unavailable"});
});

test("verified cash movements stay visible and explain the original cash equation",async()=>{
 const d=await verified("1900.25","1","0.25");
 expect((await reader.load(d.owner,d.command.intentId)).settlement).toMatchObject({cashBefore:"2000",cashAfter:"1900.25",actualDebit:"100.5",interveningCredits:"1",interveningDebits:"0.25"});
});
test("a later-recorded ignored response updates check time without replacing accepted evidence",async()=>{
 const d=await approved(),older=await recovery.begin(d.owner,d.command.intentId);advance(10);
 const newer=await recovery.begin(d.owner,d.command.intentId);advance(100);
 await recovery.record(d.owner,newer.id,responseOf(order(d,{status:"complete",executed_qty:"0.5",leaves_qty:"0",fee:"0.5",executed_vwap:"200"})));const acceptedAt=clock().toISOString();advance(5000);
 await recovery.record(d.owner,older.id,{source:"contract_fixture",kind:"unavailable"});
 expect(await reader.load(d.owner,d.command.intentId)).toMatchObject({actual:{recordedAt:acceptedAt,filledBase:"0.5"},latestCheck:{at:clock().toISOString(),kind:"unavailable",disposition:"ignored"}});
});
test("an untyped planning date cannot serialize nested private metadata",async()=>{
 const d=await approved();await admin.query("UPDATE harborline.calculation_snapshots SET input=jsonb_set(input,'{asOfLocalDate}',$2::jsonb) WHERE id=$1",[d.request.calculationId,JSON.stringify({private_key:"PRIVATE_DATE_MARKER"})]);
 await expect(reader.load(d.owner,d.command.intentId)).rejects.toMatchObject({code:"unavailable"});
});
test("valid uppercase IDs load the same historical approval and approved network",async()=>{
 const d=await approved(),record=await reader.load(d.owner,d.command.intentId.toUpperCase());
 expect(record).toMatchObject({id:d.command.intentId,approval:{network:"solana"}});
});
