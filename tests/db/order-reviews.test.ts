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
import {createReviewRepository} from "../../src/features/orders/reviews.server";
import {createReviewVault} from "../../src/features/orders/review-vault.server";
import {normalizePreparationResponse} from "../../src/integrations/truemarkets/preparation.server";
import {createOrderPreparationAdapter} from "../../src/integrations/truemarkets/preparation.server";
import {createPreparationService} from "../../src/features/orders/prepare.server";
import {runMigrations,validateMigrationTarget} from "../../scripts/migrate-db.mjs";
import {assets,quoteContext,response,instant} from "../fixtures/investment-review";
const connectionString=process.env.TEST_DATABASE_URL;
if(!connectionString||process.env.TEST_DATABASE_DISPOSABLE!=="true")throw new Error("Disposable DB required");
const target=validateMigrationTarget(connectionString,"test"),host=target.searchParams.get("host")??target.hostname;
if(!["localhost","127.0.0.1","[::1]"].includes(host)&&!host.startsWith("/tmp/harborline-hl09."))throw new Error("Local disposable DB required");
const admin=new Pool({connectionString}),runtimeUrl=new URL(connectionString);runtimeUrl.username="harborline_test_runtime";runtimeUrl.password="test-only-runtime";
const db=createDatabase(runtimeUrl.toString()),planning=createPlanningService(createPlanningRepository(db));
let now=Date.parse(instant);const clock=()=>new Date(now),intents=createIntentRepository(db,{fixtureMode:true,clock}),vault=createReviewVault(Buffer.alloc(32,9),1),reviews=createReviewRepository(db,{clock,vault});
beforeAll(async()=>{await admin.query("DROP SCHEMA IF EXISTS harborline_private CASCADE;DROP SCHEMA IF EXISTS harborline CASCADE;DROP SCHEMA IF EXISTS drizzle CASCADE");await runMigrations(connectionString,"test");await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='harborline_test_runtime') THEN CREATE ROLE harborline_test_runtime LOGIN PASSWORD 'test-only-runtime' IN ROLE harborline_app;END IF;END $$`);});
beforeEach(()=>{now=Date.parse(instant);});
afterAll(async()=>{await db.close();await admin.end();});
async function setup(){
  const identity={id:randomUUID(),email:"builder@example.invalid"},owner={...await bootstrapAccount(identity,db),email:identity.email} as OwnerContext;
  await planning.savePolicy(owner,{expectedRevision:1,horizonDays:30,additionalBuffer:"100",acknowledged:true});
  const calculations=createCalculationStore(db,clock),balance=await calculations.recordFixtureBalance(owner,{available:"2000",listingId:assets.cash.id,chain:"solana",venue:"defi"}),calculation=await calculations.capture(owner,{expectedRevision:2,balanceSnapshotId:balance.id});
  const command={requestKey:randomUUID(),operationKind:"buy",assetId:assets.stock.id,requestedQty:"100",qtyUnit:"quote",calculationId:calculation.id,expectedPolicyRevision:2},claim=await intents.claim(owner,command),preparing=await intents.beginPreparation(owner,claim.intent.id,1);
  const prepared=normalizePreparationResponse({...response(),order_id:randomUUID()},quoteContext);if(prepared.kind!=="prepared")throw new Error("fixture");
  const input={intentId:preparing.id,expectedRevision:preparing.revision,generation:preparing.preparationGeneration,prepared,evidence:{source:"contract_fixture",quoteFingerprint:prepared.quote.fingerprint,contractRef:"fixture-only",maximumDebit:"100.5",expiresAt:"2026-11-25T12:00:30.000Z",feeTreatment:"added_to_input"}};
  return {owner,command,preparing,input,calculation};
}
async function serviceSetup(run:(command:unknown)=>Promise<unknown>,overrides:Partial<Parameters<typeof createPreparationService>[0]>={}){
  const data=await setup();await intents.abandon(data.owner,data.preparing.id,data.preparing.revision);
  const providerUserId=randomUUID();await admin.query("UPDATE harborline.gateway_accounts SET provider_user_id=$2,provisioning_state='READY',public_key=$3,wallet_addresses=$4 WHERE id=$1",[data.owner.accountId,providerUserId,"02"+"a".repeat(64),JSON.stringify({solana:"11111111111111111111111111111111"})]);
  const service=createPreparationService({source:"contract_fixture",intents,reviews,clock,assets:async()=>assets,adapter:createOrderPreparationAdapter({async request(method,path,options){expect(method).toBe("POST");expect(path).toBe("/v1/gateway/orders");expect(options.userId).toBe(providerUserId);return run(options.body);}}),terms:quote=>({...data.input.evidence,quoteFingerprint:quote.fingerprint}),...overrides});
  return {...data,command:{...data.command,requestKey:randomUUID()},service};
}
test("one preparation request produces one durable review and replay makes no provider call",async()=>{
  let calls=0;const data=await serviceSetup(async()=>{calls++;return {...response(),order_id:randomUUID()};});
  const first=await data.service.prepare(data.owner,data.command),second=await data.service.prepare(data.owner,data.command);
  expect(first).toMatchObject({state:"REVIEW_READY",review:{maximumDebit:"100.5"},canApprove:false,canExecute:false});expect(second).toEqual(first);expect(calls).toBe(1);
});
test("lost preparation response persists uncertainty and a duplicate never repeats the mutation",async()=>{
  let calls=0;const data=await serviceSetup(async()=>{calls++;throw new Error("secret network response");});
  const first=await data.service.prepare(data.owner,data.command);expect(first).toMatchObject({state:"UNKNOWN",review:null});
  expect(await data.service.prepare(data.owner,data.command)).toEqual(first);expect(calls).toBe(1);expect(JSON.stringify(first)).not.toContain("secret");
});
test("fixture quote-only refusal releases its slot without a review",async()=>{
  const data=await serviceSetup(async()=>({...response(),order_id:"",payloads:[],quote:{...response().quote,issues:["Insufficient balance"]}}));
  expect(await data.service.prepare(data.owner,data.command)).toMatchObject({state:"REJECTED",review:null});expect((await admin.query("SELECT active_operation_id FROM harborline.gateway_accounts WHERE id=$1",[data.owner.accountId])).rows[0].active_operation_id).toBeNull();
});
test("competing preparations do not hold a transaction across the provider boundary",async()=>{
  let entered!:()=>void,release!:(value:unknown)=>void,calls=0;
  const started=new Promise<void>(resolve=>{entered=resolve;}),pending=new Promise(resolve=>{release=resolve;});
  const data=await serviceSetup(async()=>{calls++;entered();return pending;}),first=data.service.prepare(data.owner,data.command);
  await started;
  const replay=await data.service.prepare(data.owner,data.command);expect(replay).toMatchObject({state:"PREPARING",review:null});
  await expect(data.service.prepare(data.owner,{...data.command,requestKey:randomUUID()})).rejects.toMatchObject({code:"operation_in_progress"});
  release({...response(),order_id:randomUUID()});expect(await first).toMatchObject({state:"REVIEW_READY"});expect(calls).toBe(1);
});
test.each([{status:"complete",payloads:[]},{venue:"cefi"},{payloads:[]},{quote:null}])("unsafe provider outcome %j remains UNKNOWN without a review",async fields=>{
  const data=await serviceSetup(async()=>({...response(),order_id:randomUUID(),...fields}));
  const result=await data.service.prepare(data.owner,data.command);expect(result).toMatchObject({state:"UNKNOWN",review:null,canExecute:false});expect((await intents.get(data.owner,result.intentId)).effectsPossible).toBe(true);
});
test("stale or excessive inputs are rejected before making a provider request",async()=>{
  let calls=0;const data=await serviceSetup(async()=>{calls++;return response();});
  await expect(data.service.prepare(data.owner,{...data.command,requestedQty:"2000"})).rejects.toMatchObject({code:"invalid_terms"});expect(calls).toBe(0);
  now+=15001;await expect(data.service.prepare(data.owner,{...data.command,requestKey:randomUUID()})).rejects.toMatchObject({code:"stale_inputs"});expect(calls).toBe(0);
});
test("provider source cannot create an intent even when dependencies are injected",async()=>{
  let calls=0;const data=await serviceSetup(async()=>{calls++;return response();},{source:"provider"});
  await expect(data.service.prepare(data.owner,data.command)).rejects.toMatchObject({code:"integration_unverified"});expect(calls).toBe(0);
  expect((await admin.query("SELECT id FROM harborline.investment_intents WHERE account_id=$1",[data.owner.accountId])).rows).toHaveLength(1);
});
test("review, encrypted payloads, ready state and audit persist together",async()=>{
  const {owner,input}=await setup(),result=await reviews.record(owner,input);
  expect(result).toMatchObject({accepted:true,review:{operationKind:"buy",feeTreatment:"added_to_input",blockingReasons:["fixture_only"],intentId:input.intentId,reviewRevision:1,maximumDebit:"100.5",cash:{afterMaximumDebit:"1899.5"},canApprove:false,canExecute:false}});
  expect(await reviews.get(owner,input.intentId)).toEqual(result.review);expect((await intents.get(owner,input.intentId)).state).toBe("REVIEW_READY");
  const row=(await admin.query("SELECT * FROM harborline.order_reviews WHERE intent_id=$1",[input.intentId])).rows[0];
  expect(row.terms.payloadHashes).toEqual(input.prepared.payloads.map(p=>p.digest));expect(row.payloads_encrypted.includes(Buffer.from("unsigned-only"))).toBe(false);
  expect(vault.open(row.terms.binding,row.terms_hash,{ciphertext:row.payloads_encrypted,nonce:row.nonce,tag:row.tag,keyVersion:row.encryption_key_version})).toEqual(input.prepared.payloads);
  expect(JSON.stringify(result.review)).not.toContain("payload");expect(JSON.stringify(result.review)).not.toContain("ciphertext");
  expect((await intents.audit(owner,input.intentId)).at(-1)).toMatchObject({eventType:"durable_review_recorded"});
});
test("review ownership and append-only grants survive application-role access",async()=>{
  const first=await setup(),second=await setup();await reviews.record(first.owner,first.input);
  await expect(reviews.get(second.owner,first.input.intentId)).rejects.toMatchObject({code:"not_found"});
  for(const query of ["UPDATE harborline.order_reviews SET terms_hash=repeat('0',64)","DELETE FROM harborline.order_reviews"]){const client=await admin.connect();try{await client.query("BEGIN;SET LOCAL ROLE harborline_app");await expect(client.query(query)).rejects.toMatchObject({code:"42501"});}finally{await client.query("ROLLBACK");client.release();}}
  const client=await admin.connect();try{await client.query("BEGIN;SET LOCAL ROLE harborline_app");expect((await client.query("SELECT * FROM harborline.order_reviews")).rows).toEqual([]);}finally{await client.query("ROLLBACK");client.release();}
});
test("late generation cannot write a review or regain a replaced slot",async()=>{
  const {owner,input,preparing,command}=await setup();now+=30000;await intents.cleanup(owner,preparing.id,preparing.revision);
  const next=await intents.claim(owner,{...command,requestKey:randomUUID()});expect(await reviews.record(owner,input)).toEqual({accepted:false,review:null});
  expect((await admin.query("SELECT id FROM harborline.order_reviews WHERE intent_id=$1",[input.intentId])).rows).toEqual([]);
  expect((await admin.query("SELECT active_operation_id FROM harborline.gateway_accounts WHERE id=$1",[owner.accountId])).rows[0].active_operation_id).toBe(next.intent.id);
});
test.each(["policy","balance_age","timezone"])("changed %s prevents persistence of an executable review",async kind=>{
  const {owner,input,preparing}=await setup();
  if(kind==="policy")await admin.query("UPDATE harborline.gateway_accounts SET policy_revision=policy_revision+1 WHERE id=$1",[owner.accountId]);
  if(kind==="timezone")await admin.query("UPDATE harborline.profiles SET timezone='Asia/Kolkata' WHERE auth_user_id=$1",[owner.ownerId]);
  if(kind==="balance_age")now+=15001;
  await expect(reviews.record(owner,input)).rejects.toMatchObject({code:"stale_inputs"});
  expect(await intents.get(owner,input.intentId)).toEqual(preparing);expect(await reviews.get(owner,input.intentId)).toBeNull();
});
test("audit failure rolls back the immutable review and state together",async()=>{
  const {owner,input,preparing}=await setup();
  await admin.query(`CREATE FUNCTION harborline.test_fail_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='durable_review_recorded' THEN RAISE EXCEPTION 'private synthetic detail';END IF;RETURN NEW;END $$`);await admin.query("CREATE TRIGGER test_fail_review_audit BEFORE INSERT ON harborline.audit_events FOR EACH ROW EXECUTE FUNCTION harborline.test_fail_review_audit()");
  try{await expect(reviews.record(owner,input)).rejects.toMatchObject({code:"unavailable"});expect(await reviews.get(owner,input.intentId)).toBeNull();expect(await intents.get(owner,input.intentId)).toEqual(preparing);}finally{await admin.query("DROP TRIGGER test_fail_review_audit ON harborline.audit_events;DROP FUNCTION harborline.test_fail_review_audit()");}
});
test("an unexpected execution incident retains the slot and cannot become a review",async()=>{
  const {owner,input}=await setup();expect(await reviews.incident(owner,{intentId:input.intentId,expectedRevision:input.expectedRevision,generation:input.generation,reason:"unexpected_execution",providerOrderId:input.prepared.providerOrderId})).toBe(true);
  const held=await intents.get(owner,input.intentId);expect(held).toMatchObject({state:"UNKNOWN",effectsPossible:true,providerOrderId:null});
  now+=86400000;expect(await intents.cleanup(owner,held.id,held.revision)).toEqual(held);await expect(intents.advance(owner,held.id,held.revision,"SUBMITTING")).rejects.toMatchObject({code:"invalid_transition"});
  expect(await reviews.record(owner,input)).toEqual({accepted:false,review:null});
});
test("quote-only responses after the preparation lease are observations, not slot releases",async()=>{
  const data=await serviceSetup(async()=>{now+=30000;return {...response(),order_id:"",payloads:[],quote:{...response().quote,issues:["Insufficient balance"]}};});
  const result=await data.service.prepare(data.owner,data.command);expect(result).toMatchObject({state:"PREPARING",review:null});
  expect((await admin.query("SELECT active_operation_id FROM harborline.gateway_accounts WHERE id=$1",[data.owner.accountId])).rows[0].active_operation_id).toBe(result.intentId);
  expect((await intents.audit(data.owner,result.intentId)).at(-1)).toMatchObject({eventType:"preparation_rejection_ignored"});
});
test("a late quote-only refusal cannot clear a replacement intent",async()=>{
  let nextId:string|null=null;
  const data:Awaited<ReturnType<typeof serviceSetup>>=await serviceSetup(async()=>{
    now+=30000;const active=(await admin.query("SELECT active_operation_id FROM harborline.gateway_accounts WHERE id=$1",[data.owner.accountId])).rows[0].active_operation_id;
    const current=await intents.get(data.owner,active);await intents.cleanup(data.owner,active,current.revision);
    nextId=(await intents.claim(data.owner,{...data.command,requestKey:randomUUID()})).intent.id;
    return {...response(),order_id:"",payloads:[],quote:{...response().quote,issues:["Insufficient balance"]}};
  });
  const result=await data.service.prepare(data.owner,data.command);expect(result.state).toBe("EXPIRED");expect((await admin.query("SELECT active_operation_id FROM harborline.gateway_accounts WHERE id=$1",[data.owner.accountId])).rows[0].active_operation_id).toBe(nextId);
  expect((await intents.audit(data.owner,result.intentId)).at(-1)).toMatchObject({eventType:"preparation_rejection_ignored"});
});
test("replay never combines a READY state with a review read before completion",async()=>{
  let entered!:()=>void,release!:(value:unknown)=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;}),pending=new Promise(resolve=>{release=resolve;});
  const hooked={...reviews,async get(context:OwnerContext,id:string){const review=await reviews.get(context,id);release({...response(),order_id:randomUUID()});await first;return review;}};
  const data=await serviceSetup(async()=>{entered();return pending;},{reviews:hooked});const first:ReturnType<ReturnType<typeof createPreparationService>["prepare"]>=data.service.prepare(data.owner,data.command);await started;
  const replay=await data.service.prepare(data.owner,data.command);
  expect(replay.state==="REVIEW_READY"?replay.review!==null:replay.review===null).toBe(true);
  release({...response(),order_id:randomUUID()});await first;
});
test("freshness is checked again after the asynchronous asset read, before dispatch",async()=>{
  let calls=0;const data=await serviceSetup(async()=>{calls++;return response();},{assets:async()=>{now+=15001;return assets;}});
  await expect(data.service.prepare(data.owner,data.command)).rejects.toMatchObject({code:"stale_inputs"});expect(calls).toBe(0);
  expect((await admin.query("SELECT active_operation_id FROM harborline.gateway_accounts WHERE id=$1",[data.owner.accountId])).rows[0].active_operation_id).toBeNull();
});
test.each(["initialized","complete"])("duplicate provider reference in %s response still persists uncertainty",async status=>{
  const first=await setup();await reviews.record(first.owner,first.input);
  const data=await serviceSetup(async()=>({...response(),order_id:first.input.prepared.providerOrderId,status,payloads:status==="complete"?[]:response().payloads}));
  const result=await data.service.prepare(data.owner,data.command);expect(result).toMatchObject({state:"UNKNOWN",review:null});
  const held=await intents.get(data.owner,result.intentId);expect(held).toMatchObject({effectsPossible:true,providerOrderId:null});
  expect((await intents.audit(data.owner,result.intentId)).at(-1)).toMatchObject({eventType:"preparation_incident",metadata:{providerOrderId:first.input.prepared.providerOrderId}});
  now+=86400000;expect(await intents.cleanup(data.owner,result.intentId,held.revision)).toEqual(held);
  expect((await admin.query("SELECT active_operation_id FROM harborline.gateway_accounts WHERE id=$1",[data.owner.accountId])).rows[0].active_operation_id).toBe(result.intentId);
});
test("review response distinguishes a fee included in the input",async()=>{
  const {owner,input}=await setup(),result=await reviews.record(owner,{...input,evidence:{...input.evidence,feeTreatment:"included_in_input",maximumDebit:"100"}});
  expect(result.review).toMatchObject({operationKind:"buy",feeTreatment:"included_in_input",blockingReasons:["fixture_only"],maximumDebit:"100",cash:{afterMaximumDebit:"1900"}});
});
