import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createDatabase } from "../../src/server/db";
import { bootstrapAccount } from "../../src/features/accounts/repository.server";
import type { OwnerContext } from "../../src/features/identity/access.server";
import { createPlanningService } from "../../src/features/planning/service.server";
import { createPlanningRepository } from "../../src/features/planning/repository.server";
import { createCalculationStore } from "../../src/features/planning/snapshots.server";
import { createMarketAccountReader } from "../../src/features/market-data/repository.server";
import { createMarketReadService } from "../../src/features/market-data/service.server";
import { createGatewayReadAdapter } from "../../src/integrations/truemarkets/reads.server";
import { createECDH } from "node:crypto";
import { SOLANA_USDC_MINT, type CashBalance } from "../../src/integrations/truemarkets/read-types";
import { runMigrations, validateMigrationTarget } from "../../scripts/migrate-db.mjs";
const connectionString=process.env.TEST_DATABASE_URL;
if(!connectionString || process.env.TEST_DATABASE_DISPOSABLE!=="true") throw new Error("Disposable database required");
const target=validateMigrationTarget(connectionString,"test"),host=target.searchParams.get("host")??target.hostname;
if(!["localhost","127.0.0.1","[::1]"].includes(host)&&!host.startsWith("/tmp/harborline-hl09.")) throw new Error("Local disposable database required");
const admin=new Pool({connectionString}),runtimeUrl=new URL(connectionString);runtimeUrl.username="harborline_test_runtime";runtimeUrl.password="test-only-runtime";
const db=createDatabase(runtimeUrl.toString()),planning=createPlanningService(createPlanningRepository(db)),store=createCalculationStore(db),reader=createMarketAccountReader(db);
beforeAll(async()=>{await admin.query("DROP SCHEMA IF EXISTS harborline_private CASCADE; DROP SCHEMA IF EXISTS harborline CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE");await runMigrations(connectionString,"test");await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='harborline_test_runtime') THEN CREATE ROLE harborline_test_runtime LOGIN PASSWORD 'test-only-runtime' IN ROLE harborline_app; END IF; END $$`);});
afterAll(async()=>{await db.close();await admin.end();});
async function owner(){const identity={id:randomUUID(),email:"builder@example.invalid"};return {...await bootstrapAccount(identity,db),email:identity.email} as OwnerContext;}
const cash:CashBalance={assetId:"22222222-2222-4222-8222-222222222222",address:SOLANA_USDC_MINT,chain:"solana",venue:"defi",decimals:6,available:"1500",held:"100",total:"1600",allocated:"50"};
test("account reader derives the database mapping and rejects another owner's account",async()=>{
 const first=await owner(),second=await owner();
 expect(await reader(first)).toMatchObject({ownerId:first.ownerId,accountId:first.accountId,providerUserId:null,provisioningState:"UNPROVISIONED",pilotEnabled:false,eligibilityStatus:"UNKNOWN"});
 await expect(reader({...second,accountId:first.accountId} as OwnerContext)).rejects.toMatchObject({code:"wrong_owner"});
 await expect(reader({...first,externalRefId:"forged"} as OwnerContext)).rejects.toMatchObject({code:"wrong_owner"});
});

test("normalized fixture reads calculate from the owned stored plan without changing existing evidence",async()=>{
 const context=await owner(),providerUserId=randomUUID(),key=createECDH("prime256v1");key.generateKeys();
 const checkedAt=new Date().toISOString(),stockId="11111111-1111-4111-8111-111111111111",address="11111111111111111111111111111111";
 await admin.query("UPDATE harborline.profiles SET pilot_enabled=true,eligibility_status='ELIGIBLE',eligibility_checked_at=$1 WHERE auth_user_id=$2",[checkedAt,context.ownerId]);
 await admin.query("UPDATE harborline.gateway_accounts SET provider_user_id=$1,provisioning_state='READY',public_key=$2,wallet_addresses=$3 WHERE id=$4",[providerUserId,key.getPublicKey('hex','compressed'),JSON.stringify({solana:address}),context.accountId]);
 await planning.savePolicy(context,{expectedRevision:1,horizonDays:30,additionalBuffer:"100",acknowledged:true});
 await planning.createCommitment(context,{expectedRevision:2,label:"Rent",amount:"1200",dueDate:new Date().toISOString().slice(0,10)});
 const previousBalance=await store.recordFixtureBalance(context,{available:"1500",listingId:cash.assetId,chain:"solana",venue:"defi"});
 const previous=await store.capture(context,{expectedRevision:3,balanceSnapshotId:previousBalance.id});
 const before=(await admin.query("SELECT (SELECT count(*) FROM harborline.balance_snapshots) AS b,(SELECT count(*) FROM harborline.calculation_snapshots) AS c")).rows;
 const stock={id:stockId,address,symbol:"SAMPLE",name:"Fixture stock",chain:"solana",venue:"defi",type:"spot",asset_class:"stock",decimals:6,stable:false,status:"active",tradeable:true,networks:[],order_types:["market"]};
 const adapter=createGatewayReadAdapter({request:async(_method,path,options)=>{
  if(path.endsWith('/restrictions'))return {data:[]};
  if(path.endsWith('/availability'))return {country:"DE",allowed_product_types:["spot"],allowed_asset_classes:["stock"]};
  if(path.endsWith('/balances')){expect(options?.userId).toBe(providerUserId);return {data:[{asset_id:cash.assetId,address:cash.address,symbol:"USDC",chain:"solana",venue:"defi",decimals:6,stable:true,tradeable:false,total:cash.total,available:cash.available,held:cash.held,allocated:cash.allocated}]};}
  return path.endsWith(SOLANA_USDC_MINT)?{...stock,id:cash.assetId,address:SOLANA_USDC_MINT,symbol:"USDC",asset_class:"crypto",stable:true,tradeable:false,order_types:[]}:stock;
 }},"contract_fixture");
 const service=createMarketReadService({route:{stockId,cashId:cash.assetId,stockAddress:address},adapter,account:reader,planning:ctx=>planning.get(ctx),eligibility:async()=>({source:"contract_fixture",ownerId:context.ownerId,accountId:context.accountId,providerUserId,country:"DE",backendCountry:"DE",guidanceRef:"fixture-not-live",backendMethodRef:"fixture-not-live",stockId,quoteAssetId:cash.assetId,checkedAt,expiresAt:new Date(Date.now()+60000).toISOString(),endUserApproved:true,backendMethodVerified:true,quoteAssetVerified:true,recoveryAndExitVerified:false})});
 expect(await service.allowance(context)).toMatchObject({source:"contract_fixture",canAuthorize:false,policyRevision:3,calculation:{commitmentsTotal:"1200",additionalBuffer:"100",debitBudget:"200",shortfall:"0"}});
 expect((await admin.query("SELECT (SELECT count(*) FROM harborline.balance_snapshots) AS b,(SELECT count(*) FROM harborline.calculation_snapshots) AS c")).rows).toEqual(before);
 expect(await store.get(context,previous.id)).toEqual(previous);
 expect(await store.status(context,previous.id)).toEqual({current:true,canAuthorize:false,reason:"fixture_only"});
});
