import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createDatabase,createSignerDatabase } from "../../src/server/db";
import { bootstrapAccount } from "../../src/features/accounts/repository.server";
import type { OwnerContext } from "../../src/features/identity/access.server";
import { createPlanningRepository } from "../../src/features/planning/repository.server";
import { createPlanningService } from "../../src/features/planning/service.server";
import { createCalculationStore } from "../../src/features/planning/snapshots.server";
import { createIntentRepository } from "../../src/features/orders/repository.server";
import { createReviewRepository } from "../../src/features/orders/reviews.server";
import { createReviewVault } from "../../src/features/orders/review-vault.server";
import { createApprovalRepository } from "../../src/features/orders/approvals.server";

import {createFixtureExecutionService,createSignedApprovalService} from "../../src/features/orders/execute.server";
import {createOrderExecutionAdapter} from "../../src/integrations/truemarkets/execution.server";
import {createEncryptedSigner} from "../../src/features/accounts/key-store.server";
import {createOwnedSigner,stampEncryptedSigner} from "../../src/features/accounts/signer.server";
import {createExecutionRepository} from "../../src/features/orders/execution-repository.server";

import { normalizePreparationResponse } from "../../src/integrations/truemarkets/preparation.server";
import { runMigrations, validateMigrationTarget } from "../../scripts/migrate-db.mjs";
import { assets, quoteContext, response, instant } from "../fixtures/investment-review";
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || process.env.TEST_DATABASE_DISPOSABLE !== "true") throw new Error("Disposable DB required");
const target = validateMigrationTarget(connectionString, "test"), host = target.searchParams.get("host") ?? target.hostname;
if (!["localhost", "127.0.0.1", "[::1]"].includes(host) && !host.startsWith("/tmp/harborline-hl09.")) throw new Error("Local disposable DB required");
const admin = new Pool({ connectionString }), runtimeUrl = new URL(connectionString);
runtimeUrl.username = "harborline_test_runtime"; runtimeUrl.password = "test-only-runtime";
const db = createDatabase(runtimeUrl.toString()), planning = createPlanningService(createPlanningRepository(db));
let now = Date.parse(instant);
const clock = () => new Date(now), intents = createIntentRepository(db, { fixtureMode: true, clock });
const reviews = createReviewRepository(db, { clock, vault: createReviewVault(Buffer.alloc(32, 9), 1) });
const approvals = createApprovalRepository(db, { clock, fixtureMode: true, fixtureApprovalEnabled: true });
beforeAll(async () => {
  await admin.query("DROP SCHEMA IF EXISTS harborline_private CASCADE;DROP SCHEMA IF EXISTS harborline CASCADE;DROP SCHEMA IF EXISTS drizzle CASCADE");
  await runMigrations(connectionString, "test");
  await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='harborline_test_runtime') THEN CREATE ROLE harborline_test_runtime LOGIN PASSWORD 'test-only-runtime' IN ROLE harborline_app;END IF;END $$`);
});
beforeEach(() => { now = Date.parse(instant); });
afterAll(async () => { await db.close(); await admin.end(); });
async function setup() {
  const identity = { id: randomUUID(), email: "builder@example.invalid" };
  const owner = { ...await bootstrapAccount(identity, db), email: identity.email } as OwnerContext;
  await planning.savePolicy(owner, { expectedRevision: 1, horizonDays: 30, additionalBuffer: "100", acknowledged: true });
  const calculations = createCalculationStore(db, clock);
  const balance = await calculations.recordFixtureBalance(owner, { available: "2000", listingId: assets.cash.id, chain: "solana", venue: "defi" });
  const calculation = await calculations.capture(owner, { expectedRevision: 2, balanceSnapshotId: balance.id });
  const request = { requestKey: randomUUID(), operationKind: "buy", assetId: assets.stock.id, requestedQty: "100", qtyUnit: "quote", calculationId: calculation.id, expectedPolicyRevision: 2 };
  const claimed = await intents.claim(owner, request), preparing = await intents.beginPreparation(owner, claimed.intent.id, 1);
  const prepared = normalizePreparationResponse({ ...response(), order_id: randomUUID() }, { ...quoteContext, observedAt: new Date(now).toISOString() });
  if (prepared.kind !== "prepared") throw new Error("fixture");
  const recorded = await reviews.record(owner, { intentId: preparing.id, expectedRevision: preparing.revision, generation: preparing.preparationGeneration, prepared,
    evidence: { source: "contract_fixture", quoteFingerprint: prepared.quote.fingerprint, contractRef: "fixture-only", maximumDebit: "100.5", expiresAt: new Date(now + 30000).toISOString(), feeTreatment: "added_to_input" } });
  if (!recorded.review) throw new Error("fixture review");
  await admin.query("UPDATE harborline.gateway_accounts SET provider_user_id=$2,provisioning_state='READY',public_key=$3,wallet_addresses=$4 WHERE id=$1", [owner.accountId, randomUUID(), "02" + "a".repeat(64), JSON.stringify({ solana: "11111111111111111111111111111111" })]);
  const command = { intentId: preparing.id, reviewRevision: recorded.review.reviewRevision, termsHash: recorded.review.termsHash, acknowledged: true };
  const evidence = { source: "contract_fixture", accountId: owner.accountId, listingId: assets.cash.id, chain: "solana", venue: "defi", available: "2000", observedAt: new Date(now).toISOString() };
  return { owner, command, evidence, request, review: recorded.review };
}

const execution=createExecutionRepository(db,{clock,fixtureMode:true,fixtureExecutionEnabled:true});
test("twenty competing execution calls claim one dispatch from the stored approval",async()=>{
 const d=await setup();await approvals.approve(d.owner,d.command,d.evidence);
 const rows=await Promise.all(Array.from({length:20},()=>execution.claim(d.owner,d.command)));
 expect(rows.filter(Boolean)).toHaveLength(1);
 const row=rows.find(Boolean)!;expect(row).toMatchObject({intentId:d.command.intentId,termsHash:d.command.termsHash,providerOrderId:d.review.providerOrderId});
 expect((await admin.query("SELECT * FROM harborline.execution_dispatches WHERE account_id=$1",[d.owner.accountId])).rows).toHaveLength(1);
});
test("an unapproved review and a different owner cannot obtain a dispatch",async()=>{
 const d=await setup(),other=await setup();
 await expect(execution.claim(d.owner,d.command)).rejects.toMatchObject({code:"conflict"});
 await approvals.approve(d.owner,d.command,d.evidence);
 await expect(execution.claim(other.owner,d.command)).rejects.toMatchObject({code:"not_found"});
});
test("default-disabled execution cannot claim a dispatch",async()=>{
 const d=await setup();await approvals.approve(d.owner,d.command,d.evidence);
 await expect(createExecutionRepository(db,{clock}).claim(d.owner,d.command)).rejects.toMatchObject({code:"disabled"});
});

async function serviceSetup(run:(body:unknown)=>Promise<unknown>,onSign?:()=>void,overrides:Partial<Parameters<typeof createSignedApprovalService>[0]>={}){
 const d=await setup(),key=Buffer.alloc(32,4),record=createEncryptedSigner(d.owner.accountId,key,1);
 await admin.query("UPDATE harborline.gateway_accounts SET public_key=$2 WHERE id=$1",[d.owner.accountId,record.publicKey]);
 let signs=0;
 const service=createSignedApprovalService({source:"contract_fixture",approvals,execution,vault:createReviewVault(Buffer.alloc(32,9),1),refreshFixtureEvidence:async()=>d.evidence,
 signer:{async stamp(ctx,publicKey,payloads){signs++;onSign?.();return stampEncryptedSigner(ctx.accountId,record,new Map([[1,key]]),publicKey,payloads);}},
 adapter:createOrderExecutionAdapter({async request(_method,_path,options){return run(options.body);}}),...overrides});
 return {...d,service,signs:()=>signs};
}
test("competing signed approvals send exactly once after durable dispatch",async()=>{
 let calls=0,claimCount=0;const d=await serviceSetup(async()=>{calls++;claimCount=(await admin.query("SELECT count(*)::int AS n FROM harborline.execution_dispatches WHERE account_id=$1",[d.owner.accountId])).rows[0].n;return {status:"complete",private:"redacted"};});
 const results=await Promise.all(Array.from({length:20},()=>d.service.approve(d.owner,d.command)));
 expect(calls).toBe(1);expect(d.signs()).toBe(1);expect(claimCount).toBe(1);expect(results.filter(r=>r.accepted)).toHaveLength(1);
 expect(results.find(r=>r.accepted)).toMatchObject({state:"COMPLETE",canExecute:false});
 expect(JSON.stringify(results)).not.toMatch(/signature|ciphertext|payload|private/);
 const state=await intents.get(d.owner,d.command.intentId);now+=86400000;expect(await intents.cleanup(d.owner,state.id,state.revision)).toEqual(state);
});
test.each(["timeout","already_submitted","malformed"])("%s retains UNKNOWN and never repeats execution",async kind=>{
 let calls=0;const d=await serviceSetup(async()=>{calls++;if(kind!=="malformed")throw new Error("private "+kind);return {status:"unexpected"};});
 expect(await d.service.approve(d.owner,d.command)).toMatchObject({state:"UNKNOWN",accepted:true});
 expect(await d.service.approve(d.owner,d.command)).toMatchObject({state:"UNKNOWN",accepted:false});expect(calls).toBe(1);expect(d.signs()).toBe(1);
});
test("expiry while signing prevents the outbound call and retains the claim",async()=>{
 let calls=0;const d=await serviceSetup(async()=>{calls++;return {status:"complete"};},()=>{now+=20000;});
 expect(await d.service.approve(d.owner,d.command)).toMatchObject({state:"UNKNOWN"});expect(calls).toBe(0);
});

test.each(["expiry","balance_age","policy","slot","hash"])("changed %s cannot claim execution",async kind=>{
 const d=await setup();await approvals.approve(d.owner,d.command,d.evidence);
 if(kind==="expiry")now+=20000;
 if(kind==="balance_age")now+=15001;
 if(kind==="policy")await admin.query("UPDATE harborline.gateway_accounts SET policy_revision=3 WHERE id=$1",[d.owner.accountId]);
 if(kind==="slot")await admin.query("UPDATE harborline.gateway_accounts SET active_operation_id=NULL WHERE id=$1",[d.owner.accountId]);
 if(kind==="hash")d.command.termsHash="0".repeat(64);
 await expect(execution.claim(d.owner,d.command)).rejects.toMatchObject({code:expect.stringMatching(/conflict|stale_inputs/)});
 expect((await admin.query("SELECT * FROM harborline.execution_dispatches WHERE account_id=$1",[d.owner.accountId])).rows).toEqual([]);
});
test("a claimed but unsent operation cannot dispatch after process restart",async()=>{
 let calls=0;const d=await serviceSetup(async()=>{calls++;return {status:"complete"};});
 await approvals.approve(d.owner,d.command,d.evidence);await execution.claim(d.owner,d.command);
 const executor=createFixtureExecutionService({source:"contract_fixture",execution,vault:createReviewVault(Buffer.alloc(32,9),1),signer:{async stamp(){throw new Error("must not sign");}},adapter:createOrderExecutionAdapter({async request(){calls++;return {status:"complete"};}})});
 await executor.execute(d.owner,d.command);expect(calls).toBe(0);expect((await intents.get(d.owner,d.command.intentId)).state).toBe("SUBMITTING");
});
test("corrupt stored payloads never reach the signer or transport",async()=>{
 let calls=0;const d=await serviceSetup(async()=>{calls++;return {status:"complete"};});
 await admin.query("UPDATE harborline.order_reviews SET tag=decode(repeat('00',16),'hex') WHERE intent_id=$1",[d.command.intentId]);
 expect(await d.service.approve(d.owner,d.command)).toMatchObject({state:"UNKNOWN"});expect(d.signs()).toBe(0);expect(calls).toBe(0);
});
test("direct repeated executor calls still send once",async()=>{
 const d=await setup();await approvals.approve(d.owner,d.command,d.evidence);let calls=0;
 const service=createFixtureExecutionService({source:"contract_fixture",execution,vault:createReviewVault(Buffer.alloc(32,9),1),signer:{async stamp(){return ["fixtureStamp"];}},adapter:createOrderExecutionAdapter({async request(){calls++;return {status:"pending"};}})});
 await Promise.all(Array.from({length:20},()=>service.execute(d.owner,d.command)));
 expect(calls).toBe(1);expect((await intents.get(d.owner,d.command.intentId)).state).toBe("PENDING");
});
test("disabled controls after claiming block sending but do not block uncertainty persistence",async()=>{
 const d=await setup();await approvals.approve(d.owner,d.command,d.evidence);const flags={clock,fixtureMode:true,fixtureExecutionEnabled:true};let calls=0;
 const repo=createExecutionRepository(db,flags),service=createFixtureExecutionService({source:"contract_fixture",execution:repo,vault:createReviewVault(Buffer.alloc(32,9),1),signer:{async stamp(){flags.fixtureExecutionEnabled=false;return ["fixtureStamp"];}},adapter:createOrderExecutionAdapter({async request(){calls++;return {status:"complete"};}})});
 await service.execute(d.owner,d.command);expect(calls).toBe(0);expect((await intents.get(d.owner,d.command.intentId)).state).toBe("UNKNOWN");
});
test("dispatch audit failure rolls back the claim",async()=>{
 const d=await setup();await approvals.approve(d.owner,d.command,d.evidence);
 await admin.query("CREATE FUNCTION harborline.fail_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='execution_dispatch_claimed' THEN RAISE EXCEPTION 'private';END IF;RETURN NEW;END $$;CREATE TRIGGER fail_dispatch BEFORE INSERT ON harborline.audit_events FOR EACH ROW EXECUTE FUNCTION harborline.fail_dispatch()");
 try{await expect(execution.claim(d.owner,d.command)).rejects.toMatchObject({code:"unavailable"});expect((await admin.query("SELECT * FROM harborline.execution_dispatches WHERE account_id=$1",[d.owner.accountId])).rows).toEqual([]);}finally{await admin.query("DROP TRIGGER fail_dispatch ON harborline.audit_events;DROP FUNCTION harborline.fail_dispatch()");}
});
test("signer-role access loads only the owned persisted fixture key",async()=>{
 const d=await setup(),other=await setup(),key=Buffer.alloc(32,4),record=createEncryptedSigner(d.owner.accountId,key,1);
 await admin.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='harborline_test_signer') THEN CREATE ROLE harborline_test_signer LOGIN PASSWORD 'test-only-signer' IN ROLE harborline_key_store;END IF;END $$");
 await admin.query("INSERT INTO harborline_private.signer_secrets(account_id,encrypted_key,nonce,tag,encryption_key_version) VALUES($1,$2,$3,$4,$5)",[d.owner.accountId,record.encryptedKey,record.nonce,record.tag,1]);
 const url=new URL(connectionString!);url.username="harborline_test_signer";url.password="test-only-signer";const signerDb=createSignerDatabase(url.toString());
 const {payload}=await import("../fixtures/investment-review");
 try{const signer=createOwnedSigner(signerDb,new Map([[1,key]]));expect(await signer.stamp(d.owner,record.publicKey,[payload()])).toHaveLength(1);await expect(signer.stamp(other.owner,record.publicKey,[payload()])).rejects.toMatchObject({code:"recovery_required"});}finally{await signerDb.close();}
});
test("dispatch rows are immutable and isolated from unrelated owners and signer roles",async()=>{
 const d=await setup(),other=await setup();await approvals.approve(d.owner,d.command,d.evidence);await execution.claim(d.owner,d.command);
 for(const query of ["UPDATE harborline.execution_dispatches SET source='provider'","DELETE FROM harborline.execution_dispatches"]){
  const client=await admin.connect();try{await client.query("BEGIN;SET LOCAL ROLE harborline_app");await client.query("SELECT set_config('harborline.owner_id',$1,true)",[d.owner.ownerId]);await expect(client.query(query)).rejects.toMatchObject({code:"42501"});}finally{await client.query("ROLLBACK");client.release();}
 }
 const client=await admin.connect();try{await client.query("BEGIN;SET LOCAL ROLE harborline_app");await client.query("SELECT set_config('harborline.owner_id',$1,true)",[other.owner.ownerId]);expect((await client.query("SELECT * FROM harborline.execution_dispatches")).rows).toEqual([]);}finally{await client.query("ROLLBACK");client.release();}
 const signerClient=await admin.connect();try{await signerClient.query("BEGIN;SET LOCAL ROLE harborline_key_store");await signerClient.query("SELECT set_config('harborline.owner_id',$1,true)",[d.owner.ownerId]);await expect(signerClient.query("SELECT * FROM harborline.execution_dispatches")).rejects.toMatchObject({code:"42501"});}finally{await signerClient.query("ROLLBACK");signerClient.release();}

});
test("dispatch composite FK rejects cross-account binding independently of uniqueness",async()=>{
 const d=await setup(),other=await setup();await approvals.approve(d.owner,d.command,d.evidence);
 const attempt=(await admin.query("SELECT id FROM harborline.execution_attempts WHERE intent_id=$1",[d.command.intentId])).rows[0].id;
 const client=await admin.connect();try{await client.query("BEGIN;SET LOCAL ROLE harborline_app");await client.query("SELECT set_config('harborline.owner_id',$1,true)",[other.owner.ownerId]);await expect(client.query("INSERT INTO harborline.execution_dispatches(attempt_id,intent_id,account_id,source,claimed_at) VALUES($1,$2,$3,'contract_fixture',$4)",[attempt,other.command.intentId,other.owner.accountId,instant])).rejects.toMatchObject({code:"23503",constraint:"dispatch_owned_attempt_fk"});}finally{await client.query("ROLLBACK");client.release();}
});

test.each(["expiry","balance","controls","date","within_bounds"])("the final transport boundary rechecks %s after authorization commits",async kind=>{
 if(kind==="date")now=Date.parse("2026-11-25T23:59:59.500Z");
 const flags={clock,fixtureMode:true,fixtureExecutionEnabled:true},repo=createExecutionRepository(db,flags);let calls=0;
 const wrapped={...repo,async authorizeSend(...args:Parameters<typeof repo.authorizeSend>){
  const permit=await repo.authorizeSend(...args);
  now+=kind==="expiry"?20000:kind==="balance"?15001:kind==="within_bounds"?15000:kind==="date"?501:0;
  if(kind==="controls")flags.fixtureExecutionEnabled=false;
  return permit;
 }};
 const d=await serviceSetup(async()=>{calls++;return {status:"complete"};},undefined,{execution:wrapped});
 expect(await d.service.approve(d.owner,d.command)).toMatchObject({state:kind==="within_bounds"?"COMPLETE":"UNKNOWN"});
 expect(calls).toBe(kind==="within_bounds"?1:0);
});
