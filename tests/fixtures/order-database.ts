import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createDatabase } from "../../src/server/db";
import { bootstrapAccount } from "../../src/features/accounts/repository.server";
import type { OwnerContext } from "../../src/features/identity/access.server";
import { createPlanningRepository } from "../../src/features/planning/repository.server";
import { createPlanningService } from "../../src/features/planning/service.server";
import { createCalculationStore } from "../../src/features/planning/snapshots.server";
import { createIntentRepository } from "../../src/features/orders/repository.server";
import { createReviewRepository } from "../../src/features/orders/reviews.server";
import { createReviewVault } from "../../src/features/orders/review-vault.server";
import { createApprovalRepository } from "../../src/features/orders/approvals.server";
import { createRecoveryRepository } from "../../src/features/orders/recovery-repository.server";
import { normalizePreparationResponse } from "../../src/integrations/truemarkets/preparation.server";
import { runMigrations, validateMigrationTarget } from "../../scripts/migrate-db.mjs";
import { assets, quoteContext, response, instant } from "./investment-review";
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || process.env.TEST_DATABASE_DISPOSABLE !== "true")
  throw new Error("Disposable DB required");
const target = validateMigrationTarget(connectionString, "test"), host = target.searchParams.get("host") ?? target.hostname;
if (!["localhost", "127.0.0.1", "[::1]"].includes(host) && !host.startsWith("/tmp/harborline-hl09."))
  throw new Error("Local disposable DB required");
const admin = new Pool({ connectionString }), runtimeUrl = new URL(connectionString);
runtimeUrl.username = "harborline_test_runtime";
runtimeUrl.password = "test-only-runtime";
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
async function setup(providerOrderId: string = randomUUID()) {
  const identity = { id: randomUUID(), email: "builder@example.invalid" };
  const owner = { ...await bootstrapAccount(identity, db), email: identity.email } as OwnerContext;
  await planning.savePolicy(owner, { expectedRevision: 1, horizonDays: 30, additionalBuffer: "100", acknowledged: true });
  const calculations = createCalculationStore(db, clock);
  const balance = await calculations.recordFixtureBalance(owner, { available: "2000", listingId: assets.cash.id, chain: "solana", venue: "defi" });
  const calculation = await calculations.capture(owner, { expectedRevision: 2, balanceSnapshotId: balance.id });
  const request = { requestKey: randomUUID(), operationKind: "buy", assetId: assets.stock.id, requestedQty: "100", qtyUnit: "quote", calculationId: calculation.id, expectedPolicyRevision: 2 };
  const claimed = await intents.claim(owner, request), preparing = await intents.beginPreparation(owner, claimed.intent.id, 1);
  const prepared = normalizePreparationResponse({ ...response(), order_id: providerOrderId }, { ...quoteContext, observedAt: new Date(now).toISOString() });
  if (prepared.kind !== "prepared")
    throw new Error("fixture");
  const recorded = await reviews.record(owner, { intentId: preparing.id, expectedRevision: preparing.revision, generation: preparing.preparationGeneration, prepared,
    evidence: { source: "contract_fixture", quoteFingerprint: prepared.quote.fingerprint, contractRef: "fixture-only", maximumDebit: "100.5", expiresAt: new Date(now + 30000).toISOString(), feeTreatment: "added_to_input" } });
  if (!recorded.review)
    throw new Error("fixture review");
  await admin.query("UPDATE harborline.gateway_accounts SET provider_user_id=$2,provisioning_state='READY',public_key=$3,wallet_addresses=$4 WHERE id=$1", [owner.accountId, randomUUID(), "02" + "a".repeat(64), JSON.stringify({ solana: "11111111111111111111111111111111" })]);
  const command = { intentId: preparing.id, reviewRevision: recorded.review.reviewRevision, termsHash: recorded.review.termsHash, acknowledged: true };
  const evidence = { source: "contract_fixture", accountId: owner.accountId, listingId: assets.cash.id, chain: "solana", venue: "defi", available: "2000", observedAt: new Date(now).toISOString() };
  return { owner, command, evidence, request, review: recorded.review };
}
export const recovery = createRecoveryRepository(db, { clock, fixtureMode: true, fixtureRecoveryEnabled: true });
export { admin, db, clock, intents, approvals, setup };
export function advance(ms: number) { now += ms; }
export function order(d: Awaited<ReturnType<typeof setup>>, fields: Record<string, unknown> = {}) { return { order_id: d.review.providerOrderId, asset_id: d.request.assetId, qty: "100", qty_unit: "quote", side: "buy", type: "market", chain: "solana", venue: "defi", quote_asset: "USDC", status: "pending", executed_qty: "0", leaves_qty: "0.5", executed_vwap: "0", fee: "0", ...fields }; }
export const responseOf = (body: unknown) => ({ source: "contract_fixture" as const, kind: "response" as const, body });
export async function approved(providerOrderId?: string) { const d = await setup(providerOrderId); await approvals.approve(d.owner, d.command, d.evidence); return d; }
export async function completed(providerOrderId?: string) { const d = await approved(providerOrderId), ticket = await recovery.begin(d.owner, d.command.intentId); await recovery.record(d.owner, ticket.id, responseOf(order(d, { status: "complete", executed_qty: "0.5", leaves_qty: "0", executed_vwap: "200", fee: "0.5" }))); return { ...d, readId: ticket.id }; }
