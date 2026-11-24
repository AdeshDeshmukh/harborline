-- Generated table/policy DDL plus reviewed role/schema bootstrap. No logins or
-- passwords are created by this migration. Run with an explicitly selected admin.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'harborline_app') THEN
    CREATE ROLE harborline_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'harborline_key_store') THEN
    CREATE ROLE harborline_key_store NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('harborline_app', 'harborline_key_store')
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Existing Harborline roles have incompatible capabilities';
  END IF;
END $$;
--> statement-breakpoint
CREATE SCHEMA harborline;
--> statement-breakpoint
CREATE SCHEMA harborline_private;
--> statement-breakpoint
REVOKE ALL ON SCHEMA harborline, harborline_private FROM PUBLIC;
--> statement-breakpoint
CREATE TYPE "harborline"."eligibility_status" AS ENUM('UNKNOWN', 'ELIGIBLE', 'INELIGIBLE');--> statement-breakpoint
CREATE TYPE "harborline"."provisioning_state" AS ENUM('UNPROVISIONED', 'PROVISIONING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TABLE "harborline"."gateway_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"external_ref_id" varchar(64) NOT NULL,
	"provider_user_id" uuid,
	"provisioning_state" "harborline"."provisioning_state" DEFAULT 'UNPROVISIONED' NOT NULL,
	"public_key" varchar(66),
	"wallet_addresses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active_operation_id" uuid,
	"policy_revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_accounts_owner_id_unique" UNIQUE("owner_id"),
	CONSTRAINT "gateway_accounts_external_ref_id_unique" UNIQUE("external_ref_id"),
	CONSTRAINT "gateway_accounts_provider_user_id_unique" UNIQUE("provider_user_id"),
	CONSTRAINT "external_ref_format" CHECK ("harborline"."gateway_accounts"."external_ref_id" ~ '^[A-Za-z0-9_-]{1,64}$'),
	CONSTRAINT "signer_public_key_format" CHECK ("harborline"."gateway_accounts"."public_key" IS NULL OR "harborline"."gateway_accounts"."public_key" ~ '^(02|03)[0-9a-fA-F]{64}$'),
	CONSTRAINT "wallet_addresses_object" CHECK (jsonb_typeof("harborline"."gateway_accounts"."wallet_addresses") = 'object'),
	CONSTRAINT "positive_policy_revision" CHECK ("harborline"."gateway_accounts"."policy_revision" >= 1),
	CONSTRAINT "ready_account_identity" CHECK ("harborline"."gateway_accounts"."provisioning_state" <> 'READY' OR ("harborline"."gateway_accounts"."provider_user_id" IS NOT NULL AND "harborline"."gateway_accounts"."public_key" IS NOT NULL AND "harborline"."gateway_accounts"."wallet_addresses" <> '{}'::jsonb))
);
--> statement-breakpoint
ALTER TABLE "harborline"."gateway_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "harborline"."profiles" (
	"auth_user_id" uuid PRIMARY KEY NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"pilot_enabled" boolean DEFAULT false NOT NULL,
	"eligibility_status" "harborline"."eligibility_status" DEFAULT 'UNKNOWN' NOT NULL,
	"eligibility_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_timezone_nonempty" CHECK (length(trim("harborline"."profiles"."timezone")) > 0),
	CONSTRAINT "eligibility_requires_check" CHECK ("harborline"."profiles"."eligibility_status" = 'UNKNOWN' OR "harborline"."profiles"."eligibility_checked_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "harborline"."profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "harborline_private"."signer_secrets" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_key" "bytea" NOT NULL,
	"nonce" "bytea" NOT NULL,
	"tag" "bytea" NOT NULL,
	"encryption_key_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ciphertext_nonempty" CHECK (octet_length("harborline_private"."signer_secrets"."encrypted_key") > 0),
	CONSTRAINT "nonce_96_bits" CHECK (octet_length("harborline_private"."signer_secrets"."nonce") = 12),
	CONSTRAINT "tag_128_bits" CHECK (octet_length("harborline_private"."signer_secrets"."tag") = 16),
	CONSTRAINT "positive_encryption_key_version" CHECK ("harborline_private"."signer_secrets"."encryption_key_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "harborline_private"."signer_secrets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "harborline"."gateway_accounts" ADD CONSTRAINT "gateway_accounts_owner_id_profiles_auth_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "harborline"."profiles"("auth_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline_private"."signer_secrets" ADD CONSTRAINT "signer_secrets_account_id_gateway_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "harborline"."gateway_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "gateway_accounts_owner" ON "harborline"."gateway_accounts" AS PERMISSIVE FOR ALL TO "harborline_app" USING ("harborline"."gateway_accounts"."owner_id" = nullif(current_setting('harborline.owner_id', true), '')::uuid) WITH CHECK ("harborline"."gateway_accounts"."owner_id" = nullif(current_setting('harborline.owner_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "gateway_accounts_key_lookup" ON "harborline"."gateway_accounts" AS PERMISSIVE FOR SELECT TO "harborline_key_store" USING ("harborline"."gateway_accounts"."owner_id" = nullif(current_setting('harborline.owner_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "profiles_owner" ON "harborline"."profiles" AS PERMISSIVE FOR ALL TO "harborline_app" USING ("harborline"."profiles"."auth_user_id" = nullif(current_setting('harborline.owner_id', true), '')::uuid) WITH CHECK ("harborline"."profiles"."auth_user_id" = nullif(current_setting('harborline.owner_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "signer_secrets_owner" ON "harborline_private"."signer_secrets" AS PERMISSIVE FOR ALL TO "harborline_key_store" USING (exists (select 1 from harborline.gateway_accounts a where a.id = "harborline_private"."signer_secrets"."account_id" and a.owner_id = nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists (select 1 from harborline.gateway_accounts a where a.id = "harborline_private"."signer_secrets"."account_id" and a.owner_id = nullif(current_setting('harborline.owner_id', true), '')::uuid));
--> statement-breakpoint
-- Grants and FORCE RLS are deliberately hand-reviewed SQL; retain these on
-- future changes even where Drizzle's schema snapshot cannot express them.
ALTER TABLE harborline.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE harborline.gateway_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE harborline_private.signer_secrets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA harborline, harborline_private FROM PUBLIC;
GRANT USAGE ON SCHEMA harborline TO harborline_app;
GRANT SELECT ON harborline.profiles TO harborline_app;
GRANT INSERT (auth_user_id, timezone) ON harborline.profiles TO harborline_app;
GRANT UPDATE (timezone) ON harborline.profiles TO harborline_app;
GRANT SELECT, INSERT, UPDATE ON harborline.gateway_accounts TO harborline_app;
GRANT USAGE ON SCHEMA harborline, harborline_private TO harborline_key_store;
GRANT SELECT (id, owner_id) ON harborline.gateway_accounts TO harborline_key_store;
GRANT SELECT, INSERT, UPDATE ON harborline_private.signer_secrets TO harborline_key_store;
