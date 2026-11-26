import {expect,test} from "vitest";
import {sql} from "drizzle-orm";
import {admin,db,setup} from "../fixtures/order-database";
const names=["disposal_reads","disposal_read_observations","disposal_reviews","disposal_approvals","disposal_dispatches","disposal_send_authorizations","disposal_outcomes","disposal_settlements"].sort();
test("sale migration adds eight forced owner-RLS evidence tables without rewriting legacy tables",async()=>{
 const rows=(await admin.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='harborline'::regnamespace AND relname=ANY($1) ORDER BY relname",[names])).rows;
 expect(rows).toEqual(names.map(relname=>({relname,relrowsecurity:true,relforcerowsecurity:true})));
});
test("application role has append-only evidence grants, never update/delete or key-store access",async()=>{
 const d=await setup();
 for(const name of names){
  const r=await db.withOwner(d.owner.ownerId,tx=>tx.execute(sql`SELECT has_table_privilege(current_user,${"harborline."+name},'SELECT') AS read,has_table_privilege(current_user,${"harborline."+name},'INSERT') AS append,has_table_privilege(current_user,${"harborline."+name},'UPDATE') AS change,has_table_privilege(current_user,${"harborline."+name},'DELETE') AS remove`));
  expect(r.rows[0]).toEqual({read:true,append:true,change:false,remove:false});
  expect((await admin.query("SELECT has_table_privilege('harborline_key_store',$1,'SELECT') AS allowed",["harborline."+name])).rows[0].allowed).toBe(false);
 }
});
test("sale evidence cannot be attached to a legacy buy intent",async()=>{
 const d=await setup();
 await expect(db.withOwner(d.owner.ownerId,tx=>tx.execute(sql`INSERT INTO harborline.disposal_reads(account_id,intent_id,purpose,intent_revision,generation,binding,started_at,source) VALUES(${d.owner.accountId},${d.command.intentId},'prepare',2,1,'{}'::jsonb,now(),'contract_fixture')`))).rejects.toBeDefined();
});
test("a runtime owner can append a sale read and another owner cannot see it",async()=>{
 const {randomUUID}=await import("node:crypto"),d=await setup(),other=await setup(),intentId=randomUUID();
 await admin.query("INSERT INTO harborline.investment_intents(id,account_id,operation_kind,asset_id,requested_qty,qty_unit,request_key,request_hash,policy_revision,preparation_safety,created_at,updated_at) VALUES($1,$2,'sell',$3,'0.5','base',$4,$5,2,'contract_fixture',now(),now())",[intentId,d.owner.accountId,d.request.assetId,randomUUID(),"a".repeat(64)]);
 const r=await db.withOwner(d.owner.ownerId,tx=>tx.execute(sql`INSERT INTO harborline.disposal_reads(account_id,intent_id,purpose,intent_revision,generation,binding,started_at,source) VALUES(${d.owner.accountId},${intentId},'prepare',2,1,'{}'::jsonb,now(),'contract_fixture') RETURNING id`));
 expect(r.rows).toHaveLength(1);
 expect((await db.withOwner(other.owner.ownerId,tx=>tx.execute(sql`SELECT id FROM harborline.disposal_reads WHERE intent_id=${intentId}`))).rows).toEqual([]);
});
