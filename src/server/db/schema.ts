import { sql } from "drizzle-orm";
import { boolean, check, customType, integer, jsonb, pgPolicy, pgRole, pgSchema, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

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
