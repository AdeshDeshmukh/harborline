CREATE TABLE "harborline"."recovery_work" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_check_at" timestamp with time zone NOT NULL,
	"stopped" boolean DEFAULT false NOT NULL,
	"source" varchar(32) DEFAULT 'contract_fixture' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recovery_work_intent" UNIQUE("intent_id"),
	CONSTRAINT "recovery_work_valid" CHECK ("harborline"."recovery_work"."source"='contract_fixture' AND "harborline"."recovery_work"."attempts">=0 AND isfinite("harborline"."recovery_work"."next_check_at") AND isfinite("harborline"."recovery_work"."updated_at") AND (("harborline"."recovery_work"."lease_token" IS NULL AND "harborline"."recovery_work"."lease_until" IS NULL) OR ("harborline"."recovery_work"."lease_token" IS NOT NULL AND "harborline"."recovery_work"."lease_until" IS NOT NULL AND isfinite("harborline"."recovery_work"."lease_until"))))
);
--> statement-breakpoint
ALTER TABLE "harborline"."recovery_work" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "harborline"."settlement_balance_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"order_read_id" uuid NOT NULL,
	"sequence" bigserial NOT NULL,
	"basis" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"source" varchar(32) NOT NULL,
	CONSTRAINT "settlement_balance_read_owned_identity" UNIQUE("id","intent_id","account_id"),
	CONSTRAINT "settlement_balance_read_valid" CHECK ("harborline"."settlement_balance_reads"."source"='contract_fixture' AND jsonb_typeof("harborline"."settlement_balance_reads"."basis")='object' AND octet_length("harborline"."settlement_balance_reads"."basis"::text)<=4096 AND isfinite("harborline"."settlement_balance_reads"."started_at"))
);
--> statement-breakpoint
ALTER TABLE "harborline"."settlement_balance_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "harborline"."settlement_balances" (
	"balance_read_id" uuid NOT NULL,
	"sequence" bigserial NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"read_id" uuid NOT NULL,
	"intent_revision" integer NOT NULL,
	"provider_user_id" uuid NOT NULL,
	"cash_id" uuid NOT NULL,
	"available" numeric(38, 18) NOT NULL,
	"total" numeric(38, 18) NOT NULL,
	"held" numeric(38, 18) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"source" varchar(32) NOT NULL,
	CONSTRAINT "settlement_balance_owned_identity" UNIQUE("id","intent_id","account_id"),
	CONSTRAINT "settlement_balance_read_unique" UNIQUE("balance_read_id"),
	CONSTRAINT "settlement_balance_valid" CHECK ("harborline"."settlement_balances"."source"='contract_fixture' AND "harborline"."settlement_balances"."intent_revision">0 AND "harborline"."settlement_balances"."available">=0 AND "harborline"."settlement_balances"."held">=0 AND "harborline"."settlement_balances"."total"="harborline"."settlement_balances"."available"+"harborline"."settlement_balances"."held" AND "harborline"."settlement_balances"."total"<>'NaN'::numeric AND isfinite("harborline"."settlement_balances"."observed_at") AND isfinite("harborline"."settlement_balances"."recorded_at") AND "harborline"."settlement_balances"."recorded_at">="harborline"."settlement_balances"."observed_at")
);
--> statement-breakpoint
ALTER TABLE "harborline"."settlement_balances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "harborline"."settlement_verifications" (
	"baseline_balance_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"read_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"proof_hash" varchar(64) NOT NULL,
	"actual_debit" numeric(38, 18) NOT NULL,
	"intervening_credits" numeric(38, 18) NOT NULL,
	"intervening_debits" numeric(38, 18) NOT NULL,
	"evidence_references" jsonb NOT NULL,
	"method" varchar(16) DEFAULT 'manual' NOT NULL,
	"source" varchar(32) NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	CONSTRAINT "settlement_verification_intent" UNIQUE("intent_id"),
	CONSTRAINT "settlement_verification_request" UNIQUE("account_id","request_key"),
	CONSTRAINT "settlement_verification_valid" CHECK ("harborline"."settlement_verifications"."source"='contract_fixture' AND "harborline"."settlement_verifications"."method"='manual' AND "harborline"."settlement_verifications"."proof_hash" ~ '^[0-9a-f]{64}$' AND "harborline"."settlement_verifications"."actual_debit">=0 AND "harborline"."settlement_verifications"."intervening_credits">=0 AND "harborline"."settlement_verifications"."intervening_debits">=0 AND "harborline"."settlement_verifications"."actual_debit"<>'NaN'::numeric AND "harborline"."settlement_verifications"."intervening_credits"<>'NaN'::numeric AND "harborline"."settlement_verifications"."intervening_debits"<>'NaN'::numeric AND jsonb_typeof("harborline"."settlement_verifications"."evidence_references")='object' AND octet_length("harborline"."settlement_verifications"."evidence_references"::text)<=2048 AND isfinite("harborline"."settlement_verifications"."verified_at"))
);
--> statement-breakpoint
ALTER TABLE "harborline"."settlement_verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "harborline"."recovery_work" ADD CONSTRAINT "recovery_work_owned_intent_fk" FOREIGN KEY ("intent_id","account_id") REFERENCES "harborline"."investment_intents"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."settlement_balance_reads" ADD CONSTRAINT "settlement_balance_read_owned_order_fk" FOREIGN KEY ("order_read_id","intent_id","account_id") REFERENCES "harborline"."order_recovery_reads"("id","intent_id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."settlement_balances" ADD CONSTRAINT "settlement_balance_owned_capture_fk" FOREIGN KEY ("balance_read_id","intent_id","account_id") REFERENCES "harborline"."settlement_balance_reads"("id","intent_id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."settlement_balances" ADD CONSTRAINT "settlement_balance_owned_read_fk" FOREIGN KEY ("read_id","intent_id","account_id") REFERENCES "harborline"."order_recovery_reads"("id","intent_id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."settlement_verifications" ADD CONSTRAINT "settlement_verified_baseline_fk" FOREIGN KEY ("baseline_balance_id","account_id") REFERENCES "harborline"."balance_snapshots"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."settlement_verifications" ADD CONSTRAINT "settlement_verification_owned_balance_fk" FOREIGN KEY ("observation_id","intent_id","account_id") REFERENCES "harborline"."settlement_balances"("id","intent_id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."settlement_verifications" ADD CONSTRAINT "settlement_verification_owned_read_fk" FOREIGN KEY ("read_id","intent_id","account_id") REFERENCES "harborline"."order_recovery_reads"("id","intent_id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recovery_work_due" ON "harborline"."recovery_work" USING btree ("account_id","stopped","next_check_at");--> statement-breakpoint
CREATE INDEX "settlement_balance_read_sequence" ON "harborline"."settlement_balance_reads" USING btree ("account_id","intent_id","sequence");--> statement-breakpoint
CREATE INDEX "settlement_balance_intent" ON "harborline"."settlement_balances" USING btree ("account_id","intent_id","recorded_at");--> statement-breakpoint
CREATE POLICY "recovery_work_owner" ON "harborline"."recovery_work" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."recovery_work"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."recovery_work"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "settlement_balance_reads_owner" ON "harborline"."settlement_balance_reads" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."settlement_balance_reads"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."settlement_balance_reads"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "settlement_balances_owner" ON "harborline"."settlement_balances" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."settlement_balances"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."settlement_balances"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "settlement_verifications_owner" ON "harborline"."settlement_verifications" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."settlement_verifications"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."settlement_verifications"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE harborline.recovery_work FORCE ROW LEVEL SECURITY;
ALTER TABLE harborline.settlement_balance_reads FORCE ROW LEVEL SECURITY;
ALTER TABLE harborline.settlement_balances FORCE ROW LEVEL SECURITY;
ALTER TABLE harborline.settlement_verifications FORCE ROW LEVEL SECURITY;
REVOKE ALL ON harborline.recovery_work,harborline.settlement_balance_reads,harborline.settlement_balances,harborline.settlement_verifications FROM PUBLIC,harborline_key_store,harborline_app;
GRANT SELECT,INSERT ON harborline.recovery_work,harborline.settlement_balance_reads,harborline.settlement_balances,harborline.settlement_verifications TO harborline_app;
GRANT UPDATE(lease_token,lease_until,attempts,next_check_at,stopped,updated_at) ON harborline.recovery_work TO harborline_app;
GRANT USAGE ON SEQUENCE harborline.settlement_balance_reads_sequence_seq,harborline.settlement_balances_sequence_seq TO harborline_app;
