import { sql } from "drizzle-orm";
import { bigserial, boolean, check, customType, date, foreignKey, index, integer, jsonb, numeric, pgPolicy, pgRole, pgSchema, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import type { CalculationInput } from "../../features/planning/snapshot-types";
import type { AllowanceResult } from "../../features/planning/types";

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
}, table => [
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
}, table => [
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
}, table => [
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
}, table => [
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
}, table => [
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
}, table => [
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
}, table => [
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
