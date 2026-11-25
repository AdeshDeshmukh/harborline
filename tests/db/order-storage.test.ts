import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {afterAll,beforeAll,beforeEach,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {createDatabase} from "../../src/server/db";
import {bootstrapAccount} from "../../src/features/accounts/repository.server";
import type {OwnerContext} from "../../src/features/identity/access.server";
import {createPlanningRepository} from "../../src/features/planning/repository.server";
import {createPlanningService} from "../../src/features/planning/service.server";
import {createCalculationStore} from "../../src/features/planning/snapshots.server";
import {createIntentRepository} from "../../src/features/orders/repository.server";
import {runMigrations,validateMigrationTarget} from "../../scripts/migrate-db.mjs";
const connectionString=process.env.TEST_DATABASE_URL;
if(!connectionString||process.env.TEST_DATABASE_DISPOSABLE!=="true")throw new Error("Disposable DB required");
const target=validateMigrationTarget(connectionString,"test"),host=target.searchParams.get("host")??target.hostname;
if(!["localhost","127.0.0.1","[::1]"].includes(host)&&!host.startsWith("/tmp/harborline-hl09."))throw new Error("Local disposable DB required");
const admin=new Pool({connectionString}),runtimeUrl=new URL(connectionString);runtimeUrl.username="harborline_test_runtime";runtimeUrl.password="test-only-runtime";
const db=createDatabase(runtimeUrl.toString()),planning=createPlanningService(createPlanningRepository(db));
let now=Date.parse("2026-11-25T12:00:00Z");const clock=()=>new Date(now),store=createIntentRepository(db,{fixtureMode:true,clock});
beforeAll(async()=>{await admin.query("DROP SCHEMA IF EXISTS harborline_private CASCADE;DROP SCHEMA IF EXISTS harborline CASCADE;DROP SCHEMA IF EXISTS drizzle CASCADE");await runMigrations(connectionString,"test");await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='harborline_test_runtime') THEN CREATE ROLE harborline_test_runtime LOGIN PASSWORD 'test-only-runtime' IN ROLE harborline_app;END IF;END $$`);});
beforeEach(()=>{now=Date.parse("2026-11-25T12:00:00Z");});
afterAll(async()=>{await db.close();await admin.end();});
async function setup(){const identity={id:randomUUID(),email:"builder@example.invalid"};const owner={...await bootstrapAccount(identity,db),email:identity.email} as OwnerContext;await planning.savePolicy(owner,{expectedRevision:1,horizonDays:30,additionalBuffer:"100",acknowledged:true});const calculations=createCalculationStore(db,clock),balance=await calculations.recordFixtureBalance(owner,{available:"2000",listingId:"fixture-usdc",chain:"solana",venue:"defi"}),calculation=await calculations.capture(owner,{expectedRevision:2,balanceSnapshotId:balance.id});const command={requestKey:randomUUID(),operationKind:"buy",assetId:randomUUID(),requestedQty:"100",qtyUnit:"quote",calculationId:calculation.id,expectedPolicyRevision:2};return {owner,command};}
async function ready(){const setupData=await setup(),claimed=await store.claim(setupData.owner,setupData.command),preparing=await store.beginPreparation(setupData.owner,claimed.intent.id,1);const completed=await store.finishPreparation(setupData.owner,{id:preparing.id,expectedRevision:preparing.revision,generation:preparing.preparationGeneration,providerOrderId:randomUUID(),reviewExpiresAt:new Date(now+20000).toISOString()});return {...setupData,intent:completed.intent};}
async function active(accountId:string){return (await admin.query("SELECT active_operation_id FROM harborline.gateway_accounts WHERE id=$1",[accountId])).rows[0].active_operation_id;}

test("concurrent same-key same-body requests produce one intent and one audit event",async()=>{
 const {owner,command}=await setup();const results=await Promise.all(Array.from({length:8},()=>store.claim(owner,command)));
 expect(new Set(results.map(result=>result.intent.id)).size).toBe(1);expect(results.filter(result=>!result.replayed)).toHaveLength(1);
 const intent=results[0].intent;expect(intent).toMatchObject({state:"DRAFT",revision:1,preparationGeneration:0,requestedQty:"100",canExecute:false});expect(await active(owner.accountId)).toBe(intent.id);expect(await store.audit(owner,intent.id)).toHaveLength(1);
 await expect(planning.savePolicy(owner,{expectedRevision:2,horizonDays:60,additionalBuffer:"100",acknowledged:true})).rejects.toMatchObject({code:"operation_in_progress"});
});
test("same key changed body conflicts without changing the original record",async()=>{
 const {owner,command}=await setup(),first=await store.claim(owner,command);
 await expect(store.claim(owner,{...command,requestedQty:"101"})).rejects.toMatchObject({code:"request_conflict"});
 expect(await store.get(owner,first.intent.id)).toEqual(first.intent);expect(await store.audit(owner,first.intent.id)).toHaveLength(1);
});
test("different concurrent request keys cannot both claim the account slot",async()=>{
 const {owner,command}=await setup(),results=await Promise.allSettled([store.claim(owner,command),store.claim(owner,{...command,requestKey:randomUUID()})]);
 expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);expect(results.filter(result=>result.status==="rejected").map(result=>result.reason.code)).toEqual(["operation_in_progress"]);
});
test("calculation and intent ownership cannot cross accounts",async()=>{
 const first=await setup(),second=await setup(),claimed=await store.claim(first.owner,first.command);
 await expect(store.get(second.owner,claimed.intent.id)).rejects.toMatchObject({code:"not_found"});
 await expect(store.audit(second.owner,claimed.intent.id)).rejects.toMatchObject({code:"not_found"});
 await expect(store.claim(second.owner,{...second.command,calculationId:first.command.calculationId})).rejects.toMatchObject({code:"stale_calculation"});
 await expect(store.get({...second.owner,accountId:first.owner.accountId} as OwnerContext,claimed.intent.id)).rejects.toMatchObject({code:"not_found"});
 await expect(admin.query("UPDATE harborline.gateway_accounts SET active_operation_id=$1 WHERE id=$2",[claimed.intent.id,second.owner.accountId])).rejects.toMatchObject({code:"23503"});
 expect(await active(second.owner.accountId)).toBeNull();
});
test("request fields and audit records are immutable to the application role",async()=>{
 const {owner,command}=await setup(),{intent}=await store.claim(owner,command);
 const client=await admin.connect();try{await client.query("BEGIN;SET LOCAL ROLE harborline_app");await client.query("SELECT set_config('harborline.owner_id',$1,true)",[owner.ownerId]);await expect(client.query("UPDATE harborline.investment_intents SET requested_qty=999 WHERE id=$1",[intent.id])).rejects.toMatchObject({code:"42501"});}finally{await client.query("ROLLBACK");client.release();}
 for(const query of ["UPDATE harborline.audit_events SET event_type='forged'","DELETE FROM harborline.audit_events","DELETE FROM harborline.investment_intents"]){const client=await admin.connect();try{await client.query("BEGIN;SET LOCAL ROLE harborline_app");await expect(client.query(query)).rejects.toMatchObject({code:"42501"});}finally{await client.query("ROLLBACK");client.release();}}
 const other=await setup();expect((await store.audit(owner,intent.id))[0]).toMatchObject({eventType:"intent_claimed"});await expect(store.audit(other.owner,intent.id)).rejects.toMatchObject({code:"not_found"});
});
test("preparation generations fence old and expired responses without restoring a review",async()=>{
 const {owner,command}=await setup(),{intent}=await store.claim(owner,command),first=await store.beginPreparation(owner,intent.id,1);
 await expect(store.beginPreparation(owner,intent.id,first.revision)).rejects.toMatchObject({code:"invalid_transition"});
 now+=30000;const second=await store.beginPreparation(owner,intent.id,first.revision);expect(second).toMatchObject({preparationGeneration:2,revision:3,state:"PREPARING"});
 const lateId=randomUUID(),late=await store.finishPreparation(owner,{id:intent.id,expectedRevision:first.revision,generation:1,providerOrderId:lateId,reviewExpiresAt:new Date(now+20000).toISOString()});expect(late.accepted).toBe(false);expect(late.intent).toEqual(second);
 expect((await store.audit(owner,intent.id)).some(event=>event.eventType==="preparation_response_ignored"&&event.metadata.providerOrderId===lateId)).toBe(true);
 const accepted=await store.finishPreparation(owner,{id:intent.id,expectedRevision:second.revision,generation:2,providerOrderId:randomUUID(),reviewExpiresAt:new Date(now+20000).toISOString()});expect(accepted.accepted).toBe(true);expect(accepted.intent.state).toBe("REVIEW_READY");
});
test("unverified preparation lease expiry keeps the slot and never permits re-execution",async()=>{
 const {owner,command}=await setup(),unknownStore=createIntentRepository(db,{clock}),{intent}=await unknownStore.claim(owner,command);const preparing=await unknownStore.beginPreparation(owner,intent.id,1);
 now+=30000;const held=await unknownStore.cleanup(owner,intent.id,preparing.revision);expect(held).toMatchObject({state:"UNKNOWN",effectsPossible:true});expect(await active(owner.accountId)).toBe(intent.id);
 now+=86400000;expect(await unknownStore.cleanup(owner,intent.id,held.revision)).toEqual(held);
 await expect(unknownStore.beginPreparation(owner,intent.id,held.revision)).rejects.toMatchObject({code:"invalid_transition"});
 await expect(unknownStore.advance(owner,intent.id,held.revision,"SUBMITTING")).rejects.toMatchObject({code:"invalid_transition"});
});
test("safe fixture cleanup releases only its own slot and replay never resurrects it",async()=>{
 const {owner,command}=await setup(),{intent}=await store.claim(owner,command),preparing=await store.beginPreparation(owner,intent.id,1);now+=30000;
 const expired=await store.cleanup(owner,intent.id,preparing.revision);expect(expired.state).toBe("EXPIRED");expect(await active(owner.accountId)).toBeNull();
 const next=await store.claim(owner,{...command,requestKey:randomUUID()});expect(await active(owner.accountId)).toBe(next.intent.id);
 expect((await store.claim(owner,command)).intent).toEqual(expired);expect(await store.cleanup(owner,intent.id,expired.revision)).toEqual(expired);expect(await active(owner.accountId)).toBe(next.intent.id);
 const ignored=await store.finishPreparation(owner,{id:intent.id,expectedRevision:preparing.revision,generation:1,providerOrderId:randomUUID(),reviewExpiresAt:new Date(now+20000).toISOString()});expect(ignored.accepted).toBe(false);expect(await active(owner.accountId)).toBe(next.intent.id);
});
test("expired review wins against a submission attempt at the deadline",async()=>{
 const {owner,intent}=await ready();now+=20000;
 const results=await Promise.allSettled([store.advance(owner,intent.id,intent.revision,"SUBMITTING"),store.cleanup(owner,intent.id,intent.revision)]);
 expect(results[0].status).toBe("rejected");expect((await store.get(owner,intent.id)).state).toBe("EXPIRED");expect(await active(owner.accountId)).toBeNull();
});
test("competing submission CAS writes produce one winner and financial states never regress",async()=>{
 const {owner,intent}=await ready();const results=await Promise.allSettled([store.advance(owner,intent.id,intent.revision,"SUBMITTING"),store.advance(owner,intent.id,intent.revision,"SUBMITTING")]);expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
 const submitting=await store.get(owner,intent.id),unknown=await store.advance(owner,intent.id,submitting.revision,"UNKNOWN");now+=86400000;
 expect(await store.cleanup(owner,intent.id,unknown.revision)).toEqual(unknown);await expect(store.advance(owner,intent.id,unknown.revision,"SUBMITTING")).rejects.toMatchObject({code:"invalid_transition"});
 const complete=await store.advance(owner,intent.id,unknown.revision,"COMPLETE");await expect(store.advance(owner,intent.id,complete.revision,"PENDING")).rejects.toMatchObject({code:"invalid_transition"});expect(await active(owner.accountId)).toBe(intent.id);
 await expect(admin.query("UPDATE harborline.investment_intents SET effects_possible=false,revision=revision+1 WHERE id=$1",[intent.id])).rejects.toMatchObject({code:"23514"});
});
test("unsigned abandonment and ten-minute draft cleanup do not claim provider execution",async()=>{
 const first=await setup(),a=await store.claim(first.owner,first.command),abandoned=await store.abandon(first.owner,a.intent.id,1);expect(abandoned.state).toBe("ABANDONED");expect(await active(first.owner.accountId)).toBeNull();
 const next=await store.claim(first.owner,{...first.command,requestKey:randomUUID()});now+=600000;expect((await store.cleanup(first.owner,next.intent.id,1)).state).toBe("ABANDONED");
});
test("audit insertion failure rolls back intent, slot and transition together",async()=>{
 const {owner,command}=await setup();await admin.query(`CREATE FUNCTION harborline.test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private synthetic detail'; END $$`);await admin.query("CREATE TRIGGER test_fail_audit BEFORE INSERT ON harborline.audit_events FOR EACH ROW EXECUTE FUNCTION harborline.test_fail_audit()");
 try{await expect(store.claim(owner,command)).rejects.toMatchObject({code:"unavailable",message:"Order storage is temporarily unavailable"});expect(await active(owner.accountId)).toBeNull();expect((await admin.query("SELECT id FROM harborline.investment_intents WHERE account_id=$1",[owner.accountId])).rows).toEqual([]);}finally{await admin.query("DROP TRIGGER test_fail_audit ON harborline.audit_events;DROP FUNCTION harborline.test_fail_audit()");}
});
test("migration reruns preserve intents and seven journal entries",async()=>{
 const {owner,command}=await setup(),{intent}=await store.claim(owner,command);await runMigrations(connectionString,"test");expect(await store.get(owner,intent.id)).toEqual(intent);expect((await admin.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows).toEqual([{n:7}]);
});
test("definitive fixture rejection releases while unverified rejection keeps an unknown operation",async()=>{
 const first=await setup(),a=await store.claim(first.owner,first.command),p=await store.beginPreparation(first.owner,a.intent.id,1);
 expect((await store.rejectPreparation(first.owner,a.intent.id,p.revision)).state).toBe("REJECTED");expect(await active(first.owner.accountId)).toBeNull();
 const second=await setup(),unverified=createIntentRepository(db,{clock}),b=await unverified.claim(second.owner,second.command),q=await unverified.beginPreparation(second.owner,b.intent.id,1);
 expect((await unverified.rejectPreparation(second.owner,b.intent.id,q.revision)).state).toBe("UNKNOWN");expect(await active(second.owner.accountId)).toBe(b.intent.id);
});
test("a domain conflict after a state write also rolls back the state and audit",async()=>{
 const {owner,command}=await setup(),{intent}=await store.claim(owner,command);
 await admin.query(`CREATE FUNCTION harborline.test_skip_slot_release() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${owner.accountId}'::uuid AND NEW.active_operation_id IS NULL THEN RETURN NULL;END IF;RETURN NEW;END $$`);
 await admin.query("CREATE TRIGGER test_skip_slot_release BEFORE UPDATE ON harborline.gateway_accounts FOR EACH ROW EXECUTE FUNCTION harborline.test_skip_slot_release()");
 try{await expect(store.abandon(owner,intent.id,1)).rejects.toMatchObject({code:"conflict"});expect(await store.get(owner,intent.id)).toEqual(intent);expect(await active(owner.accountId)).toBe(intent.id);expect(await store.audit(owner,intent.id)).toHaveLength(1);}finally{await admin.query("DROP TRIGGER test_skip_slot_release ON harborline.gateway_accounts;DROP FUNCTION harborline.test_skip_slot_release()");}
});
test("unscoped and signer roles cannot read the new owned tables",async()=>{
 const {owner,command}=await setup();await store.claim(owner,command);
 for(const role of ["harborline_app","harborline_key_store"]){for(const table of ["investment_intents","audit_events"]){const client=await admin.connect();try{await client.query("BEGIN");await client.query(`SET LOCAL ROLE ${role}`);if(role==="harborline_app")expect((await client.query(`SELECT * FROM harborline.${table}`)).rows).toEqual([]);else await expect(client.query(`SELECT * FROM harborline.${table}`)).rejects.toMatchObject({code:"42501"});}finally{await client.query("ROLLBACK");client.release();}}}
});
test("database rejects unverified reviews and any second entry into submission",async()=>{
 const first=await setup(),unverified=createIntentRepository(db,{clock}),a=await unverified.claim(first.owner,first.command),preparing=await unverified.beginPreparation(first.owner,a.intent.id,1);
 async function rejectedWrite(owner:OwnerContext,intentId:string,set:string,values:unknown[]=[]){const client=await admin.connect();try{await client.query("BEGIN;SET LOCAL ROLE harborline_app");await client.query("SELECT set_config('harborline.owner_id',$1,true)",[owner.ownerId]);await expect.soft(client.query(`UPDATE harborline.investment_intents SET ${set},revision=revision+1 WHERE id=$1`,[intentId,...values])).rejects.toMatchObject({code:"23514"});}finally{await client.query("ROLLBACK");client.release();}}
 await rejectedWrite(first.owner,a.intent.id,"state='REVIEW_READY',provider_order_id=$2,review_expires_at=$3",[randomUUID(),new Date(now+20000)]);
 expect(await unverified.get(first.owner,a.intent.id)).toEqual(preparing);
 const second=await ready(),submitting=await store.advance(second.owner,second.intent.id,second.intent.revision,"SUBMITTING"),pending=await store.advance(second.owner,second.intent.id,submitting.revision,"PENDING");
 await rejectedWrite(second.owner,pending.id,"state='SUBMITTING'");
 const unknown=await store.advance(second.owner,pending.id,pending.revision,"UNKNOWN");await rejectedWrite(second.owner,unknown.id,"state='SUBMITTING'");
 expect(await store.get(second.owner,unknown.id)).toEqual(unknown);expect(await active(second.owner.accountId)).toBe(unknown.id);
 const third=await setup(),draft=await store.claim(third.owner,third.command);await rejectedWrite(third.owner,draft.intent.id,"state='SUBMITTING',effects_possible=true");
});
test("a suppressed slot claim rolls back the new intent and audit",async()=>{
 const {owner,command}=await setup();
 await admin.query(`CREATE FUNCTION harborline.test_skip_slot_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${owner.accountId}'::uuid AND NEW.active_operation_id IS NOT NULL THEN RETURN NULL;END IF;RETURN NEW;END $$`);
 await admin.query("CREATE TRIGGER test_skip_slot_claim BEFORE UPDATE ON harborline.gateway_accounts FOR EACH ROW EXECUTE FUNCTION harborline.test_skip_slot_claim()");
 try{await expect(store.claim(owner,command)).rejects.toMatchObject({code:"conflict"});expect(await active(owner.accountId)).toBeNull();expect((await admin.query("SELECT id FROM harborline.investment_intents WHERE account_id=$1",[owner.accountId])).rows).toEqual([]);expect((await admin.query("SELECT id FROM harborline.audit_events WHERE account_id=$1",[owner.accountId])).rows).toEqual([]);}finally{await admin.query("DROP TRIGGER test_skip_slot_claim ON harborline.gateway_accounts;DROP FUNCTION harborline.test_skip_slot_claim()");}
});
test("a matching unverified preparation response stays unknown and retains its slot",async()=>{
 const {owner,command}=await setup(),unverified=createIntentRepository(db,{clock}),{intent}=await unverified.claim(owner,command),preparing=await unverified.beginPreparation(owner,intent.id,1),providerOrderId=randomUUID();
 const result=await unverified.finishPreparation(owner,{id:intent.id,expectedRevision:preparing.revision,generation:preparing.preparationGeneration,providerOrderId,reviewExpiresAt:new Date(now+20000).toISOString()});
 expect(result).toMatchObject({accepted:false,intent:{state:"UNKNOWN",effectsPossible:true,providerOrderId,canExecute:false}});expect(await active(owner.accountId)).toBe(intent.id);
 expect((await unverified.audit(owner,intent.id)).at(-1)).toMatchObject({eventType:"preparation_unverified",metadata:{generation:1,providerOrderId}});
 await expect(unverified.advance(owner,intent.id,result.intent.revision,"SUBMITTING")).rejects.toMatchObject({code:"invalid_transition"});
});
