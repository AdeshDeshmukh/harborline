import { sql } from "drizzle-orm";
import { bigserial, boolean, check, customType, date, foreignKey, index, integer, jsonb, numeric, pgPolicy, pgRole, pgSchema, timestamp, unique, uuid, varchar, type AnyPgColumn, type PgTableExtraConfigValue } from "drizzle-orm/pg-core";
import type { CalculationInput } from "../../features/planning/snapshot-types";
import type { AllowanceResult } from "../../features/planning/types";
import type { ReviewTerms } from "../../features/orders/review-types";
import type {RecoveryBinding,RecoveryDisposition,RecoveryEvidence,RecoveryKind} from "../../features/orders/recovery-types";

const app = pgSchema("harborline");
const privateSchema = pgSchema("harborline_private");
const appRole = pgRole("harborline_app").existing();
const keyRole = pgRole("harborline_key_store").existing();
const owner = sql`nullif(current_setting('harborline.owner_id', true), '')::uuid`;
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const eligibilityStatus = app.enum("eligibility_status", ["UNKNOWN", "ELIGIBLE", "INELIGIBLE"]);
export const provisioningState = app.enum("provisioning_state", ["UNPROVISIONED", "PROVISIONING", "READY", "FAILED"]);

export const profiles = app.table("profiles", {
  authUserId: uuid("auth_user_id").primaryKey(),
  timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
  pilotEnabled: boolean("pilot_enabled").notNull().default(false),
  eligibilityStatus: eligibilityStatus("eligibility_status").notNull().default("UNKNOWN"),
  eligibilityCheckedAt: timestamp("eligibility_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table): PgTableExtraConfigValue[] => [
  check("profile_timezone_nonempty", sql`length(trim(${table.timezone})) > 0`),
  check("eligibility_requires_check", sql`${table.eligibilityStatus} = 'UNKNOWN' OR ${table.eligibilityCheckedAt} IS NOT NULL`),
  pgPolicy("profiles_owner", { for: "all", to: appRole, using: sql`${table.authUserId} = ${owner}`, withCheck: sql`${table.authUserId} = ${owner}` }),
]).enableRLS();

export const gatewayAccounts = app.table("gateway_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().unique().references(() => profiles.authUserId, { onDelete: "restrict" }),
  externalRefId: varchar("external_ref_id", { length: 64 }).notNull().unique(),
  providerUserId: uuid("provider_user_id").unique(),
  provisioningState: provisioningState("provisioning_state").notNull().default("UNPROVISIONED"),
  publicKey: varchar("public_key", { length: 66 }),
  walletAddresses: jsonb("wallet_addresses").$type<{ solana?: string; evm?: string }>().notNull().default({}),
  activeOperationId: uuid("active_operation_id"),
  policyRevision: integer("policy_revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table): PgTableExtraConfigValue[] => [
  foreignKey({columns:[table.activeOperationId,table.id],foreignColumns:[investmentIntents.id,investmentIntents.accountId],name:"account_owned_active_operation_fk"}).onDelete("restrict"),
  check("external_ref_format", sql`${table.externalRefId} ~ '^[A-Za-z0-9_-]{1,64}$'`),
  check("signer_public_key_format", sql`${table.publicKey} IS NULL OR ${table.publicKey} ~ '^(02|03)[0-9a-fA-F]{64}$'`),
  check("wallet_addresses_object", sql`jsonb_typeof(${table.walletAddresses}) = 'object'`),
  check("positive_policy_revision", sql`${table.policyRevision} >= 1`),
  check("ready_account_identity", sql`${table.provisioningState} <> 'READY' OR (${table.providerUserId} IS NOT NULL AND ${table.publicKey} IS NOT NULL AND ${table.walletAddresses} <> '{}'::jsonb)`),
  pgPolicy("gateway_accounts_owner", { for: "all", to: appRole, using: sql`${table.ownerId} = ${owner}`, withCheck: sql`${table.ownerId} = ${owner}` }),
  pgPolicy("gateway_accounts_key_lookup", { for: "select", to: keyRole, using: sql`${table.ownerId} = ${owner}` }),
]).enableRLS();

export const signerSecrets = privateSchema.table("signer_secrets", {
  accountId: uuid("account_id").primaryKey().references(() => gatewayAccounts.id, { onDelete: "restrict" }),
  encryptedKey: bytea("encrypted_key").notNull(),
  nonce: bytea("nonce").notNull(),
  tag: bytea("tag").notNull(),
  encryptionKeyVersion: integer("encryption_key_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table): PgTableExtraConfigValue[] => [
  check("ciphertext_nonempty", sql`octet_length(${table.encryptedKey}) > 0`),
  check("nonce_96_bits", sql`octet_length(${table.nonce}) = 12`),
  check("tag_128_bits", sql`octet_length(${table.tag}) = 16`),
  check("positive_encryption_key_version", sql`${table.encryptionKeyVersion} >= 1`),
  pgPolicy("signer_secrets_owner", { for: "all", to: keyRole,
    using: sql`exists (select 1 from harborline.gateway_accounts a where a.id = ${table.accountId} and a.owner_id = ${owner})`,
    withCheck: sql`exists (select 1 from harborline.gateway_accounts a where a.id = ${table.accountId} and a.owner_id = ${owner})` }),
]).enableRLS();

export const commitmentStatus = app.enum("commitment_status", ["outstanding", "paid", "removed"]);
export const planningPolicies = app.table("planning_policies", {
  accountId: uuid("account_id").primaryKey().references(() => gatewayAccounts.id, { onDelete: "restrict" }),
  horizonDays: integer("horizon_days").notNull(),
  additionalBuffer: numeric("additional_buffer", { precision: 38, scale: 18 }).notNull(),
  revision: integer("revision").notNull().default(1),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  check("planning_horizon_range", sql`${table.horizonDays} BETWEEN 1 AND 90`),
  check("planning_buffer_valid", sql`${table.additionalBuffer} >= 0 AND ${table.additionalBuffer} <> 'NaN'::numeric AND ${table.additionalBuffer} = trunc(${table.additionalBuffer}, 2)`),
  check("planning_revision_positive", sql`${table.revision} >= 1`),
  pgPolicy("planning_policies_owner", { for: "all", to: appRole,
    using: sql`exists (select 1 from harborline.gateway_accounts a where a.id = ${table.accountId} and a.owner_id = ${owner})`,
    withCheck: sql`exists (select 1 from harborline.gateway_accounts a where a.id = ${table.accountId} and a.owner_id = ${owner})` }),
]).enableRLS();

export const commitments = app.table("commitments", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => planningPolicies.accountId, { onDelete: "restrict" }),
  label: varchar("label", { length: 120 }).notNull(),
  amount: numeric("amount", { precision: 38, scale: 18 }).notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  status: commitmentStatus("status").notNull().default("outstanding"),
  revision: integer("revision").notNull().default(1),
}, (table): PgTableExtraConfigValue[] => [
  index("commitments_account_due_date").on(table.accountId, table.dueDate),
  check("commitment_label_nonempty", sql`length(trim(${table.label})) > 0 AND ${table.label} !~ '[[:cntrl:]]'`),
  check("commitment_amount_valid", sql`${table.amount} > 0 AND ${table.amount} <> 'NaN'::numeric AND ${table.amount} = trunc(${table.amount}, 2)`),
  check("commitment_date_range", sql`${table.dueDate} BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'`),
  check("commitment_revision_positive", sql`${table.revision} >= 1`),
  pgPolicy("commitments_owner", { for: "all", to: appRole,
    using: sql`exists (select 1 from harborline.gateway_accounts a where a.id = ${table.accountId} and a.owner_id = ${owner})`,
    withCheck: sql`exists (select 1 from harborline.gateway_accounts a where a.id = ${table.accountId} and a.owner_id = ${owner})` }),
]).enableRLS();

// HL-16 accepts fixture evidence only. A provider provenance path requires HL-18.
export const balanceSnapshots = app.table("balance_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => gatewayAccounts.id, { onDelete: "restrict" }),
  sequence: bigserial("sequence", { mode: "bigint" }).notNull(),
  source: varchar("source", { length: 16 }).$type<"fixture">().notNull(),
  listingId: varchar("listing_id", { length: 120 }).notNull(),
  chain: varchar("chain", { length: 120 }).notNull(),
  venue: varchar("venue", { length: 120 }).notNull(),
  available: numeric("available", { precision: 38, scale: 18 }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  unique("balance_snapshot_account_identity").on(table.id, table.accountId),
  unique("balance_snapshot_sequence_unique").on(table.sequence),
  index("balance_snapshot_account_sequence").on(table.accountId, table.sequence),
  check("balance_fixture_only", sql`${table.source} = 'fixture'`),
  check("balance_available_valid", sql`${table.available} >= 0 AND ${table.available} <> 'NaN'::numeric`),
  check("balance_observed_finite", sql`isfinite(${table.observedAt})`),
  check("balance_identity_nonempty", sql`length(trim(${table.listingId})) > 0 AND length(trim(${table.chain})) > 0 AND length(trim(${table.venue})) > 0`),
  pgPolicy("balance_snapshots_owner", { for: "all", to: appRole,
    using: sql`exists (select 1 from harborline.gateway_accounts a where a.id = ${table.accountId} and a.owner_id = ${owner})`,
    withCheck: sql`exists (select 1 from harborline.gateway_accounts a where a.id = ${table.accountId} and a.owner_id = ${owner})` }),
]).enableRLS();

export const calculationSnapshots = app.table("calculation_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => gatewayAccounts.id, { onDelete: "restrict" }),
  balanceSnapshotId: uuid("balance_snapshot_id").notNull(),
  policyRevision: integer("policy_revision").notNull(),
  formulaVersion: integer("formula_version").notNull(),
  input: jsonb("input").$type<CalculationInput>().notNull(),
  result: jsonb("result").$type<AllowanceResult>().notNull(),
  horizonEnd: date("horizon_end", { mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  unique("calculation_snapshot_account_identity").on(table.id,table.accountId),
  foreignKey({ columns: [table.balanceSnapshotId, table.accountId], foreignColumns: [balanceSnapshots.id, balanceSnapshots.accountId], name: "calculation_owned_balance_fk" }).onDelete("restrict"),
  index("calculation_snapshot_account").on(table.accountId),
  check("calculation_revision_positive", sql`${table.policyRevision} >= 1`),
  check("calculation_formula_supported", sql`${table.formulaVersion} = 1`),
  check("calculation_input_object", sql`jsonb_typeof(${table.input}) = 'object'`),
  check("calculation_result_object", sql`jsonb_typeof(${table.result}) = 'object'`),
  check("calculation_date_range", sql`${table.horizonEnd} BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'`),
  check("calculation_created_finite", sql`isfinite(${table.createdAt})`),
  pgPolicy("calculation_snapshots_owner", { for: "all", to: appRole,
    using: sql`exists (select 1 from harborline.gateway_accounts a where a.id = ${table.accountId} and a.owner_id = ${owner})`,
    withCheck: sql`exists (select 1 from harborline.gateway_accounts a where a.id = ${table.accountId} and a.owner_id = ${owner})` }),
]).enableRLS();

export const intentState = app.enum("intent_state", ["DRAFT","PREPARING","REVIEW_READY","SUBMITTING","PENDING","COMPLETE","EXPIRED","REJECTED","ABANDONED","UNKNOWN","FAILED","CANCELED","MANUAL_REVIEW"]);
export const operationKind = app.enum("operation_kind", ["buy","sell","exit"]);
export const quantityUnit = app.enum("quantity_unit", ["base","quote"]);
export const preparationSafety = app.enum("preparation_safety", ["unverified","contract_fixture"]);
export const investmentIntents = app.table("investment_intents", {
  id:uuid("id").primaryKey().defaultRandom(),
  accountId:uuid("account_id").notNull().references(():AnyPgColumn=>gatewayAccounts.id,{onDelete:"restrict"}),
  operationKind:operationKind("operation_kind").notNull(),assetId:uuid("asset_id").notNull(),
  requestedQty:numeric("requested_qty",{precision:38,scale:18}).notNull(),qtyUnit:quantityUnit("qty_unit").notNull(),
  calculationId:uuid("calculation_id"),policyRevision:integer("policy_revision").notNull(),
  requestKey:varchar("request_key",{length:64}).notNull(),requestHash:varchar("request_hash",{length:64}).notNull(),
  state:intentState("state").notNull().default("DRAFT"),revision:integer("revision").notNull().default(1),
  preparationGeneration:integer("preparation_generation").notNull().default(0),
  preparationLeaseUntil:timestamp("preparation_lease_until",{withTimezone:true}),
  reviewExpiresAt:timestamp("review_expires_at",{withTimezone:true}),providerOrderId:varchar("provider_order_id",{length:128}).unique(),
  preparationSafety:preparationSafety("preparation_safety").notNull().default("unverified"),
  effectsPossible:boolean("effects_possible").notNull().default(false),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},(table): PgTableExtraConfigValue[]=>[
  unique("intent_account_identity").on(table.id,table.accountId),unique("intent_account_request_key").on(table.accountId,table.requestKey),
  index("intent_account_created").on(table.accountId,table.createdAt),
  foreignKey({columns:[table.calculationId,table.accountId],foreignColumns:[calculationSnapshots.id,calculationSnapshots.accountId],name:"intent_owned_calculation_fk"}).onDelete("restrict"),
  check("intent_quantity_valid",sql`${table.requestedQty}>0 AND ${table.requestedQty}<>'NaN'::numeric`),
  check("intent_request_key_valid",sql`${table.requestKey} ~ '^[A-Za-z0-9_-]{1,64}$' AND ${table.requestHash} ~ '^[0-9a-f]{64}$'`),
  check("intent_revisions_valid",sql`${table.revision}>=1 AND ${table.policyRevision}>=1 AND ${table.preparationGeneration}>=0`),
  check("intent_units_valid",sql`(${table.operationKind}='buy' AND ${table.qtyUnit}='quote' AND ${table.calculationId} IS NOT NULL) OR (${table.operationKind}<>'buy' AND ${table.qtyUnit}='base')`),
  check("intent_cash_precision",sql`${table.operationKind}='sell' OR ${table.requestedQty}=trunc(${table.requestedQty},6)`),
  check("intent_draft_unstarted",sql`${table.state}<>'DRAFT' OR (${table.preparationGeneration}=0 AND ${table.providerOrderId} IS NULL AND NOT ${table.effectsPossible})`),
  check("intent_preparation_lease",sql`${table.state}<>'PREPARING' OR (${table.preparationLeaseUntil} IS NOT NULL AND ${table.preparationGeneration}>0)`),
  check("intent_review_fields",sql`${table.state}<>'REVIEW_READY' OR (${table.providerOrderId} IS NOT NULL AND ${table.reviewExpiresAt} IS NOT NULL)`),
  check("intent_fixture_states",sql`${table.state} NOT IN ('REVIEW_READY','SUBMITTING') OR ${table.preparationSafety}='contract_fixture'`),
  check("intent_effects_fenced",sql`${table.state} NOT IN ('SUBMITTING','PENDING','UNKNOWN','COMPLETE','FAILED','CANCELED','MANUAL_REVIEW') OR ${table.effectsPossible}`),
  check("intent_timestamps_finite",sql`isfinite(${table.createdAt}) AND isfinite(${table.updatedAt}) AND (${table.preparationLeaseUntil} IS NULL OR isfinite(${table.preparationLeaseUntil})) AND (${table.reviewExpiresAt} IS NULL OR isfinite(${table.reviewExpiresAt}))`),
  check("intent_provider_id_valid",sql`${table.providerOrderId} IS NULL OR ${table.providerOrderId} ~ '^[A-Za-z0-9_-]{1,128}$'`),
  pgPolicy("investment_intents_owner",{for:"all",to:appRole,using:sql`exists(select 1 from harborline.gateway_accounts a where a.id=${table.accountId} and a.owner_id=${owner})`,withCheck:sql`exists(select 1 from harborline.gateway_accounts a where a.id=${table.accountId} and a.owner_id=${owner})`}),
]).enableRLS();
export const auditEvents=app.table("audit_events",{
  id:uuid("id").primaryKey().defaultRandom(),accountId:uuid("account_id").notNull().references(()=>gatewayAccounts.id,{onDelete:"restrict"}),
  intentId:uuid("intent_id"),actorId:uuid("actor_id").references(()=>profiles.authUserId,{onDelete:"restrict"}),
  sequence:bigserial("sequence",{mode:"bigint"}).notNull().unique(),eventType:varchar("event_type",{length:64}).notNull(),
  metadata:jsonb("redacted_metadata").$type<Record<string,string|number|boolean|null>>().notNull().default({}),
  occurredAt:timestamp("occurred_at",{withTimezone:true}).notNull().defaultNow(),
},(table): PgTableExtraConfigValue[]=>[
  foreignKey({columns:[table.intentId,table.accountId],foreignColumns:[investmentIntents.id,investmentIntents.accountId],name:"audit_owned_intent_fk"}).onDelete("restrict"),
  index("audit_account_intent_sequence").on(table.accountId,table.intentId,table.sequence),
  check("audit_metadata_bounded",sql`jsonb_typeof(${table.metadata})='object' AND octet_length(${table.metadata}::text)<=4096`),
  check("audit_event_type_valid",sql`${table.eventType} ~ '^[a-z][a-z0-9_]{0,63}$' AND isfinite(${table.occurredAt})`),
  pgPolicy("audit_events_owner",{for:"all",to:appRole,using:sql`exists(select 1 from harborline.gateway_accounts a where a.id=${table.accountId} and a.owner_id=${owner})`,withCheck:sql`(${table.actorId} IS NULL OR ${table.actorId}=${owner}) AND exists(select 1 from harborline.gateway_accounts a where a.id=${table.accountId} and a.owner_id=${owner})`}),
]).enableRLS();

export const orderReviews = app.table("order_reviews", {
  id:uuid("id").primaryKey().defaultRandom(),
  accountId:uuid("account_id").notNull(),intentId:uuid("intent_id").notNull(),
  revision:integer("revision").notNull(),
  terms:jsonb("terms").$type<ReviewTerms>().notNull(),termsHash:varchar("terms_hash",{length:64}).notNull(),
  maximumDebit:numeric("maximum_debit",{precision:38,scale:18}).notNull(),
  payloadsEncrypted:bytea("payloads_encrypted").notNull(),nonce:bytea("nonce").notNull(),tag:bytea("tag").notNull(),
  encryptionKeyVersion:integer("encryption_key_version").notNull(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull(),expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),
}, (table):PgTableExtraConfigValue[]=>[
  unique("review_intent_revision").on(table.intentId,table.revision),
  foreignKey({columns:[table.intentId,table.accountId],foreignColumns:[investmentIntents.id,investmentIntents.accountId],name:"review_owned_intent_fk"}).onDelete("restrict"),
  check("review_positive_revisions",sql`${table.revision}>0 AND ${table.encryptionKeyVersion}>0`),
  check("review_terms_bounded",sql`jsonb_typeof(${table.terms})='object' AND octet_length(${table.terms}::text)<=65536 AND ${table.termsHash} ~ '^[0-9a-f]{64}$'`),
  check("review_debit_valid",sql`${table.maximumDebit}>0 AND ${table.maximumDebit}<>'NaN'::numeric AND ${table.maximumDebit}=trunc(${table.maximumDebit},6)`),
  check("review_ciphertext_bounded",sql`octet_length(${table.payloadsEncrypted}) BETWEEN 1 AND 2200000 AND octet_length(${table.nonce})=12 AND octet_length(${table.tag})=16`),
  check("review_expiry_bounded",sql`isfinite(${table.createdAt}) AND isfinite(${table.expiresAt}) AND ${table.expiresAt}>${table.createdAt} AND ${table.expiresAt}<=${table.createdAt}+interval '20 seconds'`),
  pgPolicy("order_reviews_owner",{for:"all",to:appRole,using:sql`exists(select 1 from harborline.gateway_accounts a where a.id=${table.accountId} and a.owner_id=${owner})`,withCheck:sql`exists(select 1 from harborline.gateway_accounts a where a.id=${table.accountId} and a.owner_id=${owner})`}),
]).enableRLS();

// HL-23 records fixture approval authority only. These rows are append-only;
// future execution outcomes belong to the intent/recovery state machine.
export const orderApprovals = app.table("order_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull(), intentId: uuid("intent_id").notNull(),
  ownerId: uuid("owner_id").notNull().references(() => profiles.authUserId, { onDelete: "restrict" }),
  reviewRevision: integer("review_revision").notNull(), termsHash: varchar("terms_hash", { length: 64 }).notNull(),
  balanceSnapshotId: uuid("balance_snapshot_id").notNull(),
  source: varchar("source", { length: 32 }).$type<"contract_fixture">().notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  unique("approval_intent_review").on(table.intentId, table.reviewRevision),
  unique("approval_owned_identity").on(table.id, table.intentId, table.accountId),
  foreignKey({ columns: [table.intentId, table.accountId], foreignColumns: [investmentIntents.id, investmentIntents.accountId], name: "approval_owned_intent_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.intentId, table.reviewRevision], foreignColumns: [orderReviews.intentId, orderReviews.revision], name: "approval_review_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.balanceSnapshotId, table.accountId], foreignColumns: [balanceSnapshots.id, balanceSnapshots.accountId], name: "approval_owned_balance_fk" }).onDelete("restrict"),
  check("approval_fixture_valid", sql`${table.source}='contract_fixture' AND ${table.reviewRevision}>0 AND ${table.termsHash} ~ '^[0-9a-f]{64}$' AND isfinite(${table.approvedAt})`),
  pgPolicy("order_approvals_owner", { for: "all", to: appRole,
    using: sql`exists(select 1 from harborline.gateway_accounts a where a.id=${table.accountId} and a.owner_id=${owner})`,
    withCheck: sql`${table.ownerId}=${owner} AND exists(select 1 from harborline.gateway_accounts a where a.id=${table.accountId} and a.owner_id=${owner})` }),
]).enableRLS();

export const executionAttempts = app.table("execution_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull(), intentId: uuid("intent_id").notNull(),
  approvalId: uuid("approval_id").notNull(),
  source: varchar("source", { length: 32 }).$type<"contract_fixture">().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  unique("attempt_one_per_intent").on(table.intentId),
  unique("attempt_one_per_approval").on(table.approvalId),
  unique("attempt_owned_identity").on(table.id, table.intentId, table.accountId),
  foreignKey({ columns: [table.approvalId, table.intentId, table.accountId], foreignColumns: [orderApprovals.id, orderApprovals.intentId, orderApprovals.accountId], name: "attempt_owned_approval_fk" }).onDelete("restrict"),
  check("attempt_fixture_valid", sql`${table.source}='contract_fixture' AND isfinite(${table.startedAt})`),
  pgPolicy("execution_attempts_owner", { for: "all", to: appRole,
    using: sql`exists(select 1 from harborline.gateway_accounts a where a.id=${table.accountId} and a.owner_id=${owner})`,
    withCheck: sql`exists(select 1 from harborline.gateway_accounts a where a.id=${table.accountId} and a.owner_id=${owner})` }),
]).enableRLS();

export const executionDispatches = app.table("execution_dispatches", {
  attemptId: uuid("attempt_id").primaryKey(), accountId: uuid("account_id").notNull(), intentId: uuid("intent_id").notNull(),
  source: varchar("source", { length: 32 }).$type<"contract_fixture">().notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  foreignKey({ columns: [table.attemptId, table.intentId, table.accountId], foreignColumns: [executionAttempts.id, executionAttempts.intentId, executionAttempts.accountId], name: "dispatch_owned_attempt_fk" }).onDelete("restrict"),
  check("dispatch_fixture_valid", sql`${table.source}='contract_fixture' AND isfinite(${table.claimedAt})`),
  pgPolicy("execution_dispatches_owner", { for: "all", to: appRole,
    using: sql`exists(select 1 from harborline.gateway_accounts a where a.id=${table.accountId} and a.owner_id=${owner})`,
    withCheck: sql`exists(select 1 from harborline.gateway_accounts a where a.id=${table.accountId} and a.owner_id=${owner})` }),
]).enableRLS();

export const orderRecoveryReads = app.table("order_recovery_reads", {
  id: uuid("id").primaryKey().defaultRandom(), accountId: uuid("account_id").notNull(), intentId: uuid("intent_id").notNull(), attemptId: uuid("attempt_id").notNull(),
  sequence: bigserial("sequence", { mode: "bigint" }).notNull(), intentRevision: integer("intent_revision").notNull(),
  binding: jsonb("binding").$type<RecoveryBinding>().notNull(), source: varchar("source", { length: 32 }).$type<"contract_fixture">().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
}, (t): PgTableExtraConfigValue[] => [
  unique("recovery_read_owned_identity").on(t.id, t.intentId, t.accountId), unique("recovery_read_sequence_unique").on(t.sequence),
  index("recovery_read_intent_sequence").on(t.accountId, t.intentId, t.sequence),
  foreignKey({ columns: [t.attemptId, t.intentId, t.accountId], foreignColumns: [executionAttempts.id, executionAttempts.intentId, executionAttempts.accountId], name: "recovery_owned_attempt_fk" }).onDelete("restrict"),
  check("recovery_read_valid", sql`${t.source}='contract_fixture' AND ${t.intentRevision}>0 AND isfinite(${t.startedAt}) AND jsonb_typeof(${t.binding})='object' AND octet_length(${t.binding}::text)<=2048`),
  pgPolicy("order_recovery_reads_owner", { for: "all", to: appRole, using: sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`, withCheck: sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})` }),
]).enableRLS();
export const orderRecoveryObservations = app.table("order_recovery_observations", {
  readId: uuid("read_id").primaryKey(), accountId: uuid("account_id").notNull(), intentId: uuid("intent_id").notNull(),
  kind: varchar("kind", { length: 32 }).$type<RecoveryKind>().notNull(), disposition: varchar("disposition", { length: 16 }).$type<RecoveryDisposition>().notNull(),
  evidence: jsonb("evidence").$type<RecoveryEvidence>(), observationHash: varchar("observation_hash", { length: 64 }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(), source: varchar("source", { length: 32 }).$type<"contract_fixture">().notNull(),
}, (t): PgTableExtraConfigValue[] => [
  foreignKey({ columns: [t.readId, t.intentId, t.accountId], foreignColumns: [orderRecoveryReads.id, orderRecoveryReads.intentId, orderRecoveryReads.accountId], name: "recovery_observation_owned_read_fk" }).onDelete("restrict"),
  index("recovery_observation_intent").on(t.accountId, t.intentId),
  check("recovery_observation_valid", sql`${t.source}='contract_fixture' AND ${t.kind} IN ('observed','initialized','unavailable','not_found','invalid_response') AND ${t.disposition} IN ('applied','ignored','conflict') AND ${t.observationHash} ~ '^[0-9a-f]{64}$' AND isfinite(${t.observedAt}) AND (${t.evidence} IS NULL OR (jsonb_typeof(${t.evidence})='object' AND octet_length(${t.evidence}::text)<=4096))`),
  pgPolicy("order_recovery_observations_owner", { for: "all", to: appRole, using: sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`, withCheck: sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})` }),
]).enableRLS();

export const recoveryWork = app.table("recovery_work", {
  id: uuid("id").primaryKey().defaultRandom(), accountId: uuid("account_id").notNull(), intentId: uuid("intent_id").notNull(),
  leaseToken: uuid("lease_token"), leaseUntil: timestamp("lease_until", { withTimezone: true }), attempts: integer("attempts").notNull().default(0),
  nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull(), stopped: boolean("stopped").notNull().default(false),
  source: varchar("source", { length: 32 }).notNull().default("contract_fixture"), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, t => [
  unique("recovery_work_intent").on(t.intentId), index("recovery_work_due").on(t.accountId, t.stopped, t.nextCheckAt),
  foreignKey({ columns: [t.intentId, t.accountId], foreignColumns: [investmentIntents.id, investmentIntents.accountId], name: "recovery_work_owned_intent_fk" }).onDelete("restrict"),
  check("recovery_work_valid", sql`${t.source}='contract_fixture' AND ${t.attempts}>=0 AND isfinite(${t.nextCheckAt}) AND isfinite(${t.updatedAt}) AND ((${t.leaseToken} IS NULL AND ${t.leaseUntil} IS NULL) OR (${t.leaseToken} IS NOT NULL AND ${t.leaseUntil} IS NOT NULL AND isfinite(${t.leaseUntil})))`),
  pgPolicy("recovery_work_owner", { for: "all", to: appRole, using: sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`, withCheck: sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})` }),
]).enableRLS();
export const settlementBalances = app.table("settlement_balances", {
  balanceReadId: uuid("balance_read_id").notNull(),
  sequence: bigserial("sequence", { mode: "bigint" }).notNull(),
  id: uuid("id").primaryKey().defaultRandom(), accountId: uuid("account_id").notNull(), intentId: uuid("intent_id").notNull(), readId: uuid("read_id").notNull(),
  intentRevision: integer("intent_revision").notNull(), providerUserId: uuid("provider_user_id").notNull(), cashId: uuid("cash_id").notNull(),
  available: numeric("available", { precision: 38, scale: 18 }).notNull(), total: numeric("total", { precision: 38, scale: 18 }).notNull(), held: numeric("held", { precision: 38, scale: 18 }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(), recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(), source: varchar("source", { length: 32 }).notNull(),
}, (t): PgTableExtraConfigValue[] => [
  unique("settlement_balance_owned_identity").on(t.id, t.intentId, t.accountId),
  unique("settlement_balance_read_unique").on(t.balanceReadId),
  foreignKey({ columns: [t.balanceReadId, t.intentId, t.accountId], foreignColumns: [settlementBalanceReads.id, settlementBalanceReads.intentId, settlementBalanceReads.accountId], name: "settlement_balance_owned_capture_fk" }).onDelete("restrict"), index("settlement_balance_intent").on(t.accountId, t.intentId, t.recordedAt),
  foreignKey({ columns: [t.readId, t.intentId, t.accountId], foreignColumns: [orderRecoveryReads.id, orderRecoveryReads.intentId, orderRecoveryReads.accountId], name: "settlement_balance_owned_read_fk" }).onDelete("restrict"),
  check("settlement_balance_valid", sql`${t.source}='contract_fixture' AND ${t.intentRevision}>0 AND ${t.available}>=0 AND ${t.held}>=0 AND ${t.total}=${t.available}+${t.held} AND ${t.total}<>'NaN'::numeric AND isfinite(${t.observedAt}) AND isfinite(${t.recordedAt}) AND ${t.recordedAt}>=${t.observedAt}`),
  pgPolicy("settlement_balances_owner", { for: "all", to: appRole, using: sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`, withCheck: sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})` }),
]).enableRLS();
export const settlementVerifications = app.table("settlement_verifications", {
  baselineBalanceId: uuid("baseline_balance_id").notNull(),
  id: uuid("id").primaryKey().defaultRandom(), accountId: uuid("account_id").notNull(), intentId: uuid("intent_id").notNull(), observationId: uuid("observation_id").notNull(), readId: uuid("read_id").notNull(),
  operatorId: uuid("operator_id").notNull(), requestKey: uuid("request_key").notNull(), proofHash: varchar("proof_hash", { length: 64 }).notNull(),
  actualDebit: numeric("actual_debit", { precision: 38, scale: 18 }).notNull(), interveningCredits: numeric("intervening_credits", { precision: 38, scale: 18 }).notNull(), interveningDebits: numeric("intervening_debits", { precision: 38, scale: 18 }).notNull(),
  references: jsonb("evidence_references").$type<Record<string, string>>().notNull(), method: varchar("method", { length: 16 }).notNull().default("manual"), source: varchar("source", { length: 32 }).notNull(), verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
}, t => [
  foreignKey({ columns: [t.baselineBalanceId, t.accountId], foreignColumns: [balanceSnapshots.id, balanceSnapshots.accountId], name: "settlement_verified_baseline_fk" }).onDelete("restrict"),
  unique("settlement_verification_intent").on(t.intentId), unique("settlement_verification_request").on(t.accountId, t.requestKey),
  foreignKey({ columns: [t.observationId, t.intentId, t.accountId], foreignColumns: [settlementBalances.id, settlementBalances.intentId, settlementBalances.accountId], name: "settlement_verification_owned_balance_fk" }).onDelete("restrict"),
  foreignKey({ columns: [t.readId, t.intentId, t.accountId], foreignColumns: [orderRecoveryReads.id, orderRecoveryReads.intentId, orderRecoveryReads.accountId], name: "settlement_verification_owned_read_fk" }).onDelete("restrict"),
  check("settlement_verification_valid", sql`${t.source}='contract_fixture' AND ${t.method}='manual' AND ${t.proofHash} ~ '^[0-9a-f]{64}$' AND ${t.actualDebit}>=0 AND ${t.interveningCredits}>=0 AND ${t.interveningDebits}>=0 AND ${t.actualDebit}<>'NaN'::numeric AND ${t.interveningCredits}<>'NaN'::numeric AND ${t.interveningDebits}<>'NaN'::numeric AND jsonb_typeof(${t.references})='object' AND octet_length(${t.references}::text)<=2048 AND isfinite(${t.verifiedAt})`),
  pgPolicy("settlement_verifications_owner", { for: "all", to: appRole, using: sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`, withCheck: sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})` }),
]).enableRLS();
export const settlementBalanceReads = app.table("settlement_balance_reads", {
  id: uuid("id").primaryKey().defaultRandom(), accountId: uuid("account_id").notNull(), intentId: uuid("intent_id").notNull(), orderReadId: uuid("order_read_id").notNull(),
  sequence: bigserial("sequence", { mode: "bigint" }).notNull(), basis: jsonb("basis").$type<import("../../features/orders/maintenance-types").SettlementBasis>().notNull(), startedAt: timestamp("started_at", { withTimezone: true }).notNull(), source: varchar("source", { length: 32 }).notNull(),
}, (t): PgTableExtraConfigValue[] => [
  unique("settlement_balance_read_owned_identity").on(t.id, t.intentId, t.accountId), index("settlement_balance_read_sequence").on(t.accountId, t.intentId, t.sequence),
  foreignKey({ columns: [t.orderReadId, t.intentId, t.accountId], foreignColumns: [orderRecoveryReads.id, orderRecoveryReads.intentId, orderRecoveryReads.accountId], name: "settlement_balance_read_owned_order_fk" }).onDelete("restrict"),
  check("settlement_balance_read_valid", sql`${t.source}='contract_fixture' AND jsonb_typeof(${t.basis})='object' AND octet_length(${t.basis}::text)<=4096 AND isfinite(${t.startedAt})`),
  pgPolicy("settlement_balance_reads_owner", { for: "all", to: appRole, using: sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`, withCheck: sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})` }),
]).enableRLS();

// Sale v2 evidence is additive: buy-v1 cash constraints and payload identities stay intact.
export const disposalReads = app.table("disposal_reads", {
  id:uuid("id").primaryKey().defaultRandom(),accountId:uuid("account_id").notNull(),intentId:uuid("intent_id").notNull(),
  sequence:bigserial("sequence",{mode:"bigint"}).notNull().unique(),purpose:varchar("purpose",{length:16}).$type<import("../../features/orders/disposal-store-types").SaleReadPurpose>().notNull(),
  intentRevision:integer("intent_revision").notNull(),generation:integer("generation").notNull(),binding:jsonb("binding").$type<import("../../features/orders/disposal-types").DisposalBinding>().notNull(),
  approvalId:uuid("approval_id"),orderReadId:uuid("order_read_id"),cashBaselineId:uuid("cash_baseline_id"),startedAt:timestamp("started_at",{withTimezone:true}).notNull(),source:varchar("source",{length:32}).notNull(),
},(t):PgTableExtraConfigValue[]=>[
  unique("sale_read_owned").on(t.id,t.intentId,t.accountId),unique("sale_read_owned_phase").on(t.id,t.intentId,t.accountId,t.purpose),index("sale_read_latest").on(t.accountId,t.intentId,t.purpose,t.sequence),
  foreignKey({columns:[t.intentId,t.accountId],foreignColumns:[investmentIntents.id,investmentIntents.accountId],name:"sale_read_intent_fk"}).onDelete("restrict"),
  foreignKey({columns:[t.approvalId,t.intentId,t.accountId],foreignColumns:[disposalApprovals.id,disposalApprovals.intentId,disposalApprovals.accountId],name:"sale_read_approval_fk"}).onDelete("restrict"),
  foreignKey({columns:[t.orderReadId,t.intentId,t.accountId],foreignColumns:[t.id,t.intentId,t.accountId],name:"sale_read_order_parent_fk"}).onDelete("restrict"),
  foreignKey({columns:[t.cashBaselineId,t.accountId],foreignColumns:[balanceSnapshots.id,balanceSnapshots.accountId],name:"sale_read_cash_baseline_fk"}).onDelete("restrict"),
  check("sale_read_valid",sql`${t.source}='contract_fixture' AND ${t.purpose} IN ('prepare','approval','send','order','settlement') AND ${t.intentRevision}>0 AND ${t.generation}>0 AND isfinite(${t.startedAt}) AND jsonb_typeof(${t.binding})='object' AND octet_length(${t.binding}::text)<=4096 AND ((${t.purpose} IN ('prepare','approval') AND ${t.approvalId} IS NULL AND ${t.orderReadId} IS NULL AND ${t.cashBaselineId} IS NULL) OR (${t.purpose} IN ('send','order') AND ${t.approvalId} IS NOT NULL AND ${t.orderReadId} IS NULL AND ${t.cashBaselineId} IS NULL) OR (${t.purpose}='settlement' AND ${t.approvalId} IS NOT NULL AND ${t.orderReadId} IS NOT NULL AND ${t.cashBaselineId} IS NOT NULL))`),
  pgPolicy("disposal_reads_owner",{for:"all",to:appRole,using:sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`,withCheck:sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`}),
]).enableRLS();
export const disposalReadObservations=app.table("disposal_read_observations",{
  readId:uuid("read_id").primaryKey(),accountId:uuid("account_id").notNull(),intentId:uuid("intent_id").notNull(),purpose:varchar("purpose",{length:16}).$type<import("../../features/orders/disposal-store-types").SaleReadPurpose>().notNull(),
  evidence:jsonb("evidence").$type<import("../../features/orders/disposal-store-types").SaleWalletEvidence>().notNull(),observationHash:varchar("observation_hash",{length:64}).notNull(),disposition:varchar("disposition",{length:16}).$type<"applied"|"ignored">().notNull(),recordedAt:timestamp("recorded_at",{withTimezone:true}).notNull(),
},(t):PgTableExtraConfigValue[]=>[
  unique("sale_wallet_owned").on(t.readId,t.intentId,t.accountId),unique("sale_wallet_owned_phase").on(t.readId,t.intentId,t.accountId,t.purpose),
  foreignKey({columns:[t.readId,t.intentId,t.accountId,t.purpose],foreignColumns:[disposalReads.id,disposalReads.intentId,disposalReads.accountId,disposalReads.purpose],name:"sale_wallet_read_fk"}).onDelete("restrict"),
  check("sale_wallet_valid",sql`${t.purpose} IN ('prepare','approval','send','settlement') AND ${t.disposition} IN ('applied','ignored') AND ${t.observationHash} ~ '^[0-9a-f]{64}$' AND isfinite(${t.recordedAt}) AND jsonb_typeof(${t.evidence})='object' AND octet_length(${t.evidence}::text)<=12288`),
  pgPolicy("disposal_wallet_owner",{for:"all",to:appRole,using:sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`,withCheck:sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`}),
]).enableRLS();
export const disposalReviews=app.table("disposal_reviews",{
  id:uuid("id").primaryKey().defaultRandom(),accountId:uuid("account_id").notNull(),intentId:uuid("intent_id").notNull(),revision:integer("revision").notNull(),holdingReadId:uuid("holding_read_id").notNull(),holdingReadPurpose:varchar("holding_read_purpose",{length:16}).notNull().default("prepare"),
  terms:jsonb("terms").$type<import("../../features/orders/disposal-store-types").StoredSaleTerms>().notNull(),termsHash:varchar("terms_hash",{length:64}).notNull(),maximumBaseDebit:numeric("maximum_base_debit",{precision:38,scale:18}).notNull(),
  payloadsEncrypted:bytea("payloads_encrypted").notNull(),nonce:bytea("nonce").notNull(),tag:bytea("tag").notNull(),encryptionKeyVersion:integer("encryption_key_version").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull(),expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),
},(t):PgTableExtraConfigValue[]=>[
  unique("sale_review_owned_revision").on(t.intentId,t.revision,t.accountId),
  foreignKey({columns:[t.intentId,t.accountId],foreignColumns:[investmentIntents.id,investmentIntents.accountId],name:"sale_review_intent_fk"}).onDelete("restrict"),
  foreignKey({columns:[t.holdingReadId,t.intentId,t.accountId,t.holdingReadPurpose],foreignColumns:[disposalReadObservations.readId,disposalReadObservations.intentId,disposalReadObservations.accountId,disposalReadObservations.purpose],name:"sale_review_wallet_fk"}).onDelete("restrict"),
  check("sale_review_valid",sql`${t.revision}>0 AND ${t.holdingReadPurpose}='prepare' AND ${t.maximumBaseDebit}>0 AND ${t.maximumBaseDebit}<>'NaN'::numeric AND ${t.termsHash} ~ '^[0-9a-f]{64}$' AND jsonb_typeof(${t.terms})='object' AND ${t.terms}->>'version'='2' AND ${t.terms}->>'operationKind'='sell' AND octet_length(${t.terms}::text)<=65536 AND ${t.encryptionKeyVersion}>0 AND octet_length(${t.payloadsEncrypted}) BETWEEN 1 AND 2200000 AND octet_length(${t.nonce})=12 AND octet_length(${t.tag})=16 AND isfinite(${t.createdAt}) AND isfinite(${t.expiresAt}) AND ${t.expiresAt}>${t.createdAt} AND ${t.expiresAt}<=${t.createdAt}+interval '20 seconds'`),
  pgPolicy("disposal_reviews_owner",{for:"all",to:appRole,using:sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`,withCheck:sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`}),
]).enableRLS();
export const disposalApprovals=app.table("disposal_approvals",{
  id:uuid("id").primaryKey().defaultRandom(),attemptId:uuid("attempt_id").notNull().defaultRandom(),accountId:uuid("account_id").notNull(),intentId:uuid("intent_id").notNull(),ownerId:uuid("owner_id").notNull(),operatorId:uuid("operator_id").notNull(),reviewRevision:integer("review_revision").notNull(),termsHash:varchar("terms_hash",{length:64}).notNull(),holdingReadId:uuid("holding_read_id").notNull(),holdingReadPurpose:varchar("holding_read_purpose",{length:16}).notNull().default("approval"),cashBaselineId:uuid("cash_baseline_id").notNull(),approvedAt:timestamp("approved_at",{withTimezone:true}).notNull(),source:varchar("source",{length:32}).notNull(),
},(t):PgTableExtraConfigValue[]=>[
  unique("sale_approval_owned").on(t.id,t.intentId,t.accountId),unique("sale_approval_attempt").on(t.attemptId,t.intentId,t.accountId),unique("sale_approval_intent").on(t.intentId),
  foreignKey({columns:[t.intentId,t.reviewRevision,t.accountId],foreignColumns:[disposalReviews.intentId,disposalReviews.revision,disposalReviews.accountId],name:"sale_approval_review_fk"}).onDelete("restrict"),
  foreignKey({columns:[t.holdingReadId,t.intentId,t.accountId,t.holdingReadPurpose],foreignColumns:[disposalReadObservations.readId,disposalReadObservations.intentId,disposalReadObservations.accountId,disposalReadObservations.purpose],name:"sale_approval_wallet_fk"}).onDelete("restrict"),
  foreignKey({columns:[t.cashBaselineId,t.accountId],foreignColumns:[balanceSnapshots.id,balanceSnapshots.accountId],name:"sale_approval_cash_fk"}).onDelete("restrict"),
  check("sale_approval_valid",sql`${t.source}='contract_fixture' AND ${t.reviewRevision}>0 AND ${t.holdingReadPurpose}='approval' AND ${t.termsHash} ~ '^[0-9a-f]{64}$' AND isfinite(${t.approvedAt})`),
  pgPolicy("disposal_approvals_owner",{for:"all",to:appRole,using:sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`,withCheck:sql`${t.ownerId}=${owner} AND exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`}),
]).enableRLS();
export const disposalDispatches=app.table("disposal_dispatches",{
  attemptId:uuid("attempt_id").primaryKey(),accountId:uuid("account_id").notNull(),intentId:uuid("intent_id").notNull(),claimedAt:timestamp("claimed_at",{withTimezone:true}).notNull(),source:varchar("source",{length:32}).notNull(),
},(t):PgTableExtraConfigValue[]=>[
  unique("sale_dispatch_owned").on(t.attemptId,t.intentId,t.accountId),
  foreignKey({columns:[t.attemptId,t.intentId,t.accountId],foreignColumns:[disposalApprovals.attemptId,disposalApprovals.intentId,disposalApprovals.accountId],name:"sale_dispatch_approval_fk"}).onDelete("restrict"),
  check("sale_dispatch_valid",sql`${t.source}='contract_fixture' AND isfinite(${t.claimedAt})`),
  pgPolicy("disposal_dispatches_owner",{for:"all",to:appRole,using:sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`,withCheck:sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`}),
]).enableRLS();
export const disposalSendAuthorizations=app.table("disposal_send_authorizations",{
  attemptId:uuid("attempt_id").primaryKey(),accountId:uuid("account_id").notNull(),intentId:uuid("intent_id").notNull(),readId:uuid("read_id").notNull(),readPurpose:varchar("read_purpose",{length:16}).notNull().default("send"),authorizedAt:timestamp("authorized_at",{withTimezone:true}).notNull(),source:varchar("source",{length:32}).notNull(),
},(t):PgTableExtraConfigValue[]=>[
  foreignKey({columns:[t.attemptId,t.intentId,t.accountId],foreignColumns:[disposalDispatches.attemptId,disposalDispatches.intentId,disposalDispatches.accountId],name:"sale_send_dispatch_fk"}).onDelete("restrict"),
  foreignKey({columns:[t.readId,t.intentId,t.accountId,t.readPurpose],foreignColumns:[disposalReadObservations.readId,disposalReadObservations.intentId,disposalReadObservations.accountId,disposalReadObservations.purpose],name:"sale_send_wallet_fk"}).onDelete("restrict"),
  check("sale_send_valid",sql`${t.source}='contract_fixture' AND ${t.readPurpose}='send' AND isfinite(${t.authorizedAt})`),
  pgPolicy("disposal_send_owner",{for:"all",to:appRole,using:sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`,withCheck:sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`}),
]).enableRLS();
export const disposalOutcomes=app.table("disposal_outcomes",{
  readId:uuid("read_id").primaryKey(),accountId:uuid("account_id").notNull(),intentId:uuid("intent_id").notNull(),readPurpose:varchar("read_purpose",{length:16}).notNull().default("order"),kind:varchar("kind",{length:32}).$type<RecoveryKind>().notNull(),disposition:varchar("disposition",{length:16}).$type<RecoveryDisposition>().notNull(),evidence:jsonb("evidence").$type<import("../../features/orders/disposal-store-types").SaleOrderEvidence>(),observationHash:varchar("observation_hash",{length:64}).notNull(),observedAt:timestamp("observed_at",{withTimezone:true}).notNull(),source:varchar("source",{length:32}).notNull(),
},(t):PgTableExtraConfigValue[]=>[
  unique("sale_outcome_owned").on(t.readId,t.intentId,t.accountId),index("sale_outcome_intent").on(t.accountId,t.intentId),
  foreignKey({columns:[t.readId,t.intentId,t.accountId,t.readPurpose],foreignColumns:[disposalReads.id,disposalReads.intentId,disposalReads.accountId,disposalReads.purpose],name:"sale_outcome_read_fk"}).onDelete("restrict"),
  check("sale_outcome_valid",sql`${t.source}='contract_fixture' AND ${t.readPurpose}='order' AND ${t.kind} IN ('observed','initialized','unavailable','not_found','invalid_response') AND ${t.disposition} IN ('applied','ignored','conflict') AND ${t.observationHash} ~ '^[0-9a-f]{64}$' AND isfinite(${t.observedAt}) AND (${t.evidence} IS NULL OR (jsonb_typeof(${t.evidence})='object' AND octet_length(${t.evidence}::text)<=4096))`),
  pgPolicy("disposal_outcomes_owner",{for:"all",to:appRole,using:sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`,withCheck:sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`}),
]).enableRLS();
export const disposalSettlements=app.table("disposal_settlements",{
  id:uuid("id").primaryKey().defaultRandom(),accountId:uuid("account_id").notNull(),intentId:uuid("intent_id").notNull(),approvalId:uuid("approval_id").notNull(),orderReadId:uuid("order_read_id").notNull(),walletReadId:uuid("wallet_read_id").notNull(),walletReadPurpose:varchar("wallet_read_purpose",{length:16}).notNull().default("settlement"),baselineId:uuid("baseline_id").notNull(),operatorId:uuid("operator_id").notNull(),requestKey:uuid("request_key").notNull(),proofHash:varchar("proof_hash",{length:64}).notNull(),references:jsonb("evidence_references").$type<Record<string,string>>().notNull(),result:jsonb("result").$type<import("../../features/orders/disposal-types").DisposalReconciliation>().notNull(),verifiedAt:timestamp("verified_at",{withTimezone:true}).notNull(),source:varchar("source",{length:32}).notNull(),
},(t):PgTableExtraConfigValue[]=>[
  unique("sale_settlement_intent").on(t.intentId),unique("sale_settlement_request").on(t.accountId,t.requestKey),
  foreignKey({columns:[t.approvalId,t.intentId,t.accountId],foreignColumns:[disposalApprovals.id,disposalApprovals.intentId,disposalApprovals.accountId],name:"sale_settlement_approval_fk"}).onDelete("restrict"),
  foreignKey({columns:[t.orderReadId,t.intentId,t.accountId],foreignColumns:[disposalOutcomes.readId,disposalOutcomes.intentId,disposalOutcomes.accountId],name:"sale_settlement_order_fk"}).onDelete("restrict"),
  foreignKey({columns:[t.walletReadId,t.intentId,t.accountId,t.walletReadPurpose],foreignColumns:[disposalReadObservations.readId,disposalReadObservations.intentId,disposalReadObservations.accountId,disposalReadObservations.purpose],name:"sale_settlement_wallet_fk"}).onDelete("restrict"),
  foreignKey({columns:[t.baselineId,t.accountId],foreignColumns:[balanceSnapshots.id,balanceSnapshots.accountId],name:"sale_settlement_baseline_fk"}).onDelete("restrict"),
  check("sale_settlement_references",sql`jsonb_typeof(${t.references})='object' AND octet_length(${t.references}::text)<=2048`),
  check("sale_settlement_valid",sql`${t.source}='contract_fixture' AND ${t.walletReadPurpose}='settlement' AND ${t.proofHash} ~ '^[0-9a-f]{64}$' AND isfinite(${t.verifiedAt}) AND jsonb_typeof(${t.result})='object' AND octet_length(${t.result}::text)<=8192`),
  pgPolicy("disposal_settlements_owner",{for:"all",to:appRole,using:sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`,withCheck:sql`exists(select 1 from harborline.gateway_accounts a where a.id=${t.accountId} and a.owner_id=${owner})`}),
]).enableRLS();
