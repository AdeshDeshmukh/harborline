CREATE TABLE "harborline"."disposal_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"review_revision" integer NOT NULL,
	"terms_hash" varchar(64) NOT NULL,
	"holding_read_id" uuid NOT NULL,
	"holding_read_purpose" varchar(16) DEFAULT 'approval' NOT NULL,
	"cash_baseline_id" uuid NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"source" varchar(32) NOT NULL,
	CONSTRAINT "sale_approval_owned" UNIQUE("id","intent_id","account_id"),
	CONSTRAINT "sale_approval_attempt" UNIQUE("attempt_id","intent_id","account_id"),
	CONSTRAINT "sale_approval_intent" UNIQUE("intent_id"),
	CONSTRAINT "sale_approval_valid" CHECK ("harborline"."disposal_approvals"."source"='contract_fixture' AND "harborline"."disposal_approvals"."review_revision">0 AND "harborline"."disposal_approvals"."holding_read_purpose"='approval' AND "harborline"."disposal_approvals"."terms_hash" ~ '^[0-9a-f]{64}$' AND isfinite("harborline"."disposal_approvals"."approved_at"))
);
--> statement-breakpoint
ALTER TABLE "harborline"."disposal_approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "harborline"."disposal_dispatches" (
	"attempt_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"source" varchar(32) NOT NULL,
	CONSTRAINT "sale_dispatch_owned" UNIQUE("attempt_id","intent_id","account_id"),
	CONSTRAINT "sale_dispatch_valid" CHECK ("harborline"."disposal_dispatches"."source"='contract_fixture' AND isfinite("harborline"."disposal_dispatches"."claimed_at"))
);
--> statement-breakpoint
ALTER TABLE "harborline"."disposal_dispatches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "harborline"."disposal_outcomes" (
	"read_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"read_purpose" varchar(16) DEFAULT 'order' NOT NULL,
	"kind" varchar(32) NOT NULL,
	"disposition" varchar(16) NOT NULL,
	"evidence" jsonb,
	"observation_hash" varchar(64) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"source" varchar(32) NOT NULL,
	CONSTRAINT "sale_outcome_owned" UNIQUE("read_id","intent_id","account_id"),
	CONSTRAINT "sale_outcome_valid" CHECK ("harborline"."disposal_outcomes"."source"='contract_fixture' AND "harborline"."disposal_outcomes"."read_purpose"='order' AND "harborline"."disposal_outcomes"."kind" IN ('observed','initialized','unavailable','not_found','invalid_response') AND "harborline"."disposal_outcomes"."disposition" IN ('applied','ignored','conflict') AND "harborline"."disposal_outcomes"."observation_hash" ~ '^[0-9a-f]{64}$' AND isfinite("harborline"."disposal_outcomes"."observed_at") AND ("harborline"."disposal_outcomes"."evidence" IS NULL OR (jsonb_typeof("harborline"."disposal_outcomes"."evidence")='object' AND octet_length("harborline"."disposal_outcomes"."evidence"::text)<=4096)))
);
--> statement-breakpoint
ALTER TABLE "harborline"."disposal_outcomes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "harborline"."disposal_read_observations" (
	"read_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"purpose" varchar(16) NOT NULL,
	"evidence" jsonb NOT NULL,
	"observation_hash" varchar(64) NOT NULL,
	"disposition" varchar(16) NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sale_wallet_owned" UNIQUE("read_id","intent_id","account_id"),
	CONSTRAINT "sale_wallet_owned_phase" UNIQUE("read_id","intent_id","account_id","purpose"),
	CONSTRAINT "sale_wallet_valid" CHECK ("harborline"."disposal_read_observations"."purpose" IN ('prepare','approval','send','settlement') AND "harborline"."disposal_read_observations"."disposition" IN ('applied','ignored') AND "harborline"."disposal_read_observations"."observation_hash" ~ '^[0-9a-f]{64}$' AND isfinite("harborline"."disposal_read_observations"."recorded_at") AND jsonb_typeof("harborline"."disposal_read_observations"."evidence")='object' AND octet_length("harborline"."disposal_read_observations"."evidence"::text)<=12288)
);
--> statement-breakpoint
ALTER TABLE "harborline"."disposal_read_observations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "harborline"."disposal_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"sequence" bigserial NOT NULL,
	"purpose" varchar(16) NOT NULL,
	"intent_revision" integer NOT NULL,
	"generation" integer NOT NULL,
	"binding" jsonb NOT NULL,
	"approval_id" uuid,
	"order_read_id" uuid,
	"cash_baseline_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"source" varchar(32) NOT NULL,
	CONSTRAINT "disposal_reads_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "sale_read_owned" UNIQUE("id","intent_id","account_id"),
	CONSTRAINT "sale_read_owned_phase" UNIQUE("id","intent_id","account_id","purpose"),
	CONSTRAINT "sale_read_valid" CHECK ("harborline"."disposal_reads"."source"='contract_fixture' AND "harborline"."disposal_reads"."purpose" IN ('prepare','approval','send','order','settlement') AND "harborline"."disposal_reads"."intent_revision">0 AND "harborline"."disposal_reads"."generation">0 AND isfinite("harborline"."disposal_reads"."started_at") AND jsonb_typeof("harborline"."disposal_reads"."binding")='object' AND octet_length("harborline"."disposal_reads"."binding"::text)<=4096 AND (("harborline"."disposal_reads"."purpose" IN ('prepare','approval') AND "harborline"."disposal_reads"."approval_id" IS NULL AND "harborline"."disposal_reads"."order_read_id" IS NULL AND "harborline"."disposal_reads"."cash_baseline_id" IS NULL) OR ("harborline"."disposal_reads"."purpose" IN ('send','order') AND "harborline"."disposal_reads"."approval_id" IS NOT NULL AND "harborline"."disposal_reads"."order_read_id" IS NULL AND "harborline"."disposal_reads"."cash_baseline_id" IS NULL) OR ("harborline"."disposal_reads"."purpose"='settlement' AND "harborline"."disposal_reads"."approval_id" IS NOT NULL AND "harborline"."disposal_reads"."order_read_id" IS NOT NULL AND "harborline"."disposal_reads"."cash_baseline_id" IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "harborline"."disposal_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "harborline"."disposal_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"holding_read_id" uuid NOT NULL,
	"holding_read_purpose" varchar(16) DEFAULT 'prepare' NOT NULL,
	"terms" jsonb NOT NULL,
	"terms_hash" varchar(64) NOT NULL,
	"maximum_base_debit" numeric(38, 18) NOT NULL,
	"payloads_encrypted" "bytea" NOT NULL,
	"nonce" "bytea" NOT NULL,
	"tag" "bytea" NOT NULL,
	"encryption_key_version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sale_review_owned_revision" UNIQUE("intent_id","revision","account_id"),
	CONSTRAINT "sale_review_valid" CHECK ("harborline"."disposal_reviews"."revision">0 AND "harborline"."disposal_reviews"."holding_read_purpose"='prepare' AND "harborline"."disposal_reviews"."maximum_base_debit">0 AND "harborline"."disposal_reviews"."maximum_base_debit"<>'NaN'::numeric AND "harborline"."disposal_reviews"."terms_hash" ~ '^[0-9a-f]{64}$' AND jsonb_typeof("harborline"."disposal_reviews"."terms")='object' AND "harborline"."disposal_reviews"."terms"->>'version'='2' AND "harborline"."disposal_reviews"."terms"->>'operationKind'='sell' AND octet_length("harborline"."disposal_reviews"."terms"::text)<=65536 AND "harborline"."disposal_reviews"."encryption_key_version">0 AND octet_length("harborline"."disposal_reviews"."payloads_encrypted") BETWEEN 1 AND 2200000 AND octet_length("harborline"."disposal_reviews"."nonce")=12 AND octet_length("harborline"."disposal_reviews"."tag")=16 AND isfinite("harborline"."disposal_reviews"."created_at") AND isfinite("harborline"."disposal_reviews"."expires_at") AND "harborline"."disposal_reviews"."expires_at">"harborline"."disposal_reviews"."created_at" AND "harborline"."disposal_reviews"."expires_at"<="harborline"."disposal_reviews"."created_at"+interval '20 seconds')
);
--> statement-breakpoint
ALTER TABLE "harborline"."disposal_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "harborline"."disposal_send_authorizations" (
	"attempt_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"read_id" uuid NOT NULL,
	"read_purpose" varchar(16) DEFAULT 'send' NOT NULL,
	"authorized_at" timestamp with time zone NOT NULL,
	"source" varchar(32) NOT NULL,
	CONSTRAINT "sale_send_valid" CHECK ("harborline"."disposal_send_authorizations"."source"='contract_fixture' AND "harborline"."disposal_send_authorizations"."read_purpose"='send' AND isfinite("harborline"."disposal_send_authorizations"."authorized_at"))
);
--> statement-breakpoint
ALTER TABLE "harborline"."disposal_send_authorizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "harborline"."disposal_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"order_read_id" uuid NOT NULL,
	"wallet_read_id" uuid NOT NULL,
	"wallet_read_purpose" varchar(16) DEFAULT 'settlement' NOT NULL,
	"baseline_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"proof_hash" varchar(64) NOT NULL,
	"evidence_references" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"source" varchar(32) NOT NULL,
	CONSTRAINT "sale_settlement_intent" UNIQUE("intent_id"),
	CONSTRAINT "sale_settlement_request" UNIQUE("account_id","request_key"),
	CONSTRAINT "sale_settlement_references" CHECK (jsonb_typeof("harborline"."disposal_settlements"."evidence_references")='object' AND octet_length("harborline"."disposal_settlements"."evidence_references"::text)<=2048),
	CONSTRAINT "sale_settlement_valid" CHECK ("harborline"."disposal_settlements"."source"='contract_fixture' AND "harborline"."disposal_settlements"."wallet_read_purpose"='settlement' AND "harborline"."disposal_settlements"."proof_hash" ~ '^[0-9a-f]{64}$' AND isfinite("harborline"."disposal_settlements"."verified_at") AND jsonb_typeof("harborline"."disposal_settlements"."result")='object' AND octet_length("harborline"."disposal_settlements"."result"::text)<=8192)
);
--> statement-breakpoint
ALTER TABLE "harborline"."disposal_settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "harborline"."disposal_approvals" ADD CONSTRAINT "sale_approval_review_fk" FOREIGN KEY ("intent_id","review_revision","account_id") REFERENCES "harborline"."disposal_reviews"("intent_id","revision","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."disposal_approvals" ADD CONSTRAINT "sale_approval_wallet_fk" FOREIGN KEY ("holding_read_id","intent_id","account_id","holding_read_purpose") REFERENCES "harborline"."disposal_read_observations"("read_id","intent_id","account_id","purpose") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."disposal_approvals" ADD CONSTRAINT "sale_approval_cash_fk" FOREIGN KEY ("cash_baseline_id","account_id") REFERENCES "harborline"."balance_snapshots"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."disposal_dispatches" ADD CONSTRAINT "sale_dispatch_approval_fk" FOREIGN KEY ("attempt_id","intent_id","account_id") REFERENCES "harborline"."disposal_approvals"("attempt_id","intent_id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."disposal_outcomes" ADD CONSTRAINT "sale_outcome_read_fk" FOREIGN KEY ("read_id","intent_id","account_id","read_purpose") REFERENCES "harborline"."disposal_reads"("id","intent_id","account_id","purpose") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."disposal_read_observations" ADD CONSTRAINT "sale_wallet_read_fk" FOREIGN KEY ("read_id","intent_id","account_id","purpose") REFERENCES "harborline"."disposal_reads"("id","intent_id","account_id","purpose") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."disposal_reads" ADD CONSTRAINT "sale_read_intent_fk" FOREIGN KEY ("intent_id","account_id") REFERENCES "harborline"."investment_intents"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."disposal_reads" ADD CONSTRAINT "sale_read_approval_fk" FOREIGN KEY ("approval_id","intent_id","account_id") REFERENCES "harborline"."disposal_approvals"("id","intent_id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."disposal_reads" ADD CONSTRAINT "sale_read_order_parent_fk" FOREIGN KEY ("order_read_id","intent_id","account_id") REFERENCES "harborline"."disposal_reads"("id","intent_id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."disposal_reads" ADD CONSTRAINT "sale_read_cash_baseline_fk" FOREIGN KEY ("cash_baseline_id","account_id") REFERENCES "harborline"."balance_snapshots"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."disposal_reviews" ADD CONSTRAINT "sale_review_intent_fk" FOREIGN KEY ("intent_id","account_id") REFERENCES "harborline"."investment_intents"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."disposal_reviews" ADD CONSTRAINT "sale_review_wallet_fk" FOREIGN KEY ("holding_read_id","intent_id","account_id","holding_read_purpose") REFERENCES "harborline"."disposal_read_observations"("read_id","intent_id","account_id","purpose") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."disposal_send_authorizations" ADD CONSTRAINT "sale_send_dispatch_fk" FOREIGN KEY ("attempt_id","intent_id","account_id") REFERENCES "harborline"."disposal_dispatches"("attempt_id","intent_id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."disposal_send_authorizations" ADD CONSTRAINT "sale_send_wallet_fk" FOREIGN KEY ("read_id","intent_id","account_id","read_purpose") REFERENCES "harborline"."disposal_read_observations"("read_id","intent_id","account_id","purpose") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."disposal_settlements" ADD CONSTRAINT "sale_settlement_approval_fk" FOREIGN KEY ("approval_id","intent_id","account_id") REFERENCES "harborline"."disposal_approvals"("id","intent_id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."disposal_settlements" ADD CONSTRAINT "sale_settlement_order_fk" FOREIGN KEY ("order_read_id","intent_id","account_id") REFERENCES "harborline"."disposal_outcomes"("read_id","intent_id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."disposal_settlements" ADD CONSTRAINT "sale_settlement_wallet_fk" FOREIGN KEY ("wallet_read_id","intent_id","account_id","wallet_read_purpose") REFERENCES "harborline"."disposal_read_observations"("read_id","intent_id","account_id","purpose") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."disposal_settlements" ADD CONSTRAINT "sale_settlement_baseline_fk" FOREIGN KEY ("baseline_id","account_id") REFERENCES "harborline"."balance_snapshots"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_outcome_intent" ON "harborline"."disposal_outcomes" USING btree ("account_id","intent_id");--> statement-breakpoint
CREATE INDEX "sale_read_latest" ON "harborline"."disposal_reads" USING btree ("account_id","intent_id","purpose","sequence");--> statement-breakpoint
CREATE POLICY "disposal_approvals_owner" ON "harborline"."disposal_approvals" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."disposal_approvals"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK ("harborline"."disposal_approvals"."owner_id"=nullif(current_setting('harborline.owner_id', true), '')::uuid AND exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."disposal_approvals"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "disposal_dispatches_owner" ON "harborline"."disposal_dispatches" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."disposal_dispatches"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."disposal_dispatches"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "disposal_outcomes_owner" ON "harborline"."disposal_outcomes" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."disposal_outcomes"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."disposal_outcomes"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "disposal_wallet_owner" ON "harborline"."disposal_read_observations" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."disposal_read_observations"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."disposal_read_observations"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "disposal_reads_owner" ON "harborline"."disposal_reads" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."disposal_reads"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."disposal_reads"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "disposal_reviews_owner" ON "harborline"."disposal_reviews" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."disposal_reviews"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."disposal_reviews"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "disposal_send_owner" ON "harborline"."disposal_send_authorizations" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."disposal_send_authorizations"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."disposal_send_authorizations"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "disposal_settlements_owner" ON "harborline"."disposal_settlements" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."disposal_settlements"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."disposal_settlements"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE harborline.disposal_reads FORCE ROW LEVEL SECURITY;
REVOKE ALL ON harborline.disposal_reads FROM PUBLIC,harborline_key_store,harborline_app;
GRANT SELECT,INSERT ON harborline.disposal_reads TO harborline_app;

--> statement-breakpoint
ALTER TABLE harborline.disposal_read_observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON harborline.disposal_read_observations FROM PUBLIC,harborline_key_store,harborline_app;
GRANT SELECT,INSERT ON harborline.disposal_read_observations TO harborline_app;

--> statement-breakpoint
ALTER TABLE harborline.disposal_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON harborline.disposal_reviews FROM PUBLIC,harborline_key_store,harborline_app;
GRANT SELECT,INSERT ON harborline.disposal_reviews TO harborline_app;

--> statement-breakpoint
ALTER TABLE harborline.disposal_approvals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON harborline.disposal_approvals FROM PUBLIC,harborline_key_store,harborline_app;
GRANT SELECT,INSERT ON harborline.disposal_approvals TO harborline_app;

--> statement-breakpoint
ALTER TABLE harborline.disposal_dispatches FORCE ROW LEVEL SECURITY;
REVOKE ALL ON harborline.disposal_dispatches FROM PUBLIC,harborline_key_store,harborline_app;
GRANT SELECT,INSERT ON harborline.disposal_dispatches TO harborline_app;

--> statement-breakpoint
ALTER TABLE harborline.disposal_send_authorizations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON harborline.disposal_send_authorizations FROM PUBLIC,harborline_key_store,harborline_app;
GRANT SELECT,INSERT ON harborline.disposal_send_authorizations TO harborline_app;

--> statement-breakpoint
ALTER TABLE harborline.disposal_outcomes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON harborline.disposal_outcomes FROM PUBLIC,harborline_key_store,harborline_app;
GRANT SELECT,INSERT ON harborline.disposal_outcomes TO harborline_app;

--> statement-breakpoint
ALTER TABLE harborline.disposal_settlements FORCE ROW LEVEL SECURITY;
REVOKE ALL ON harborline.disposal_settlements FROM PUBLIC,harborline_key_store,harborline_app;
GRANT SELECT,INSERT ON harborline.disposal_settlements TO harborline_app;
--> statement-breakpoint
CREATE FUNCTION harborline.require_disposal_intent() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM harborline.investment_intents i WHERE i.id=NEW.intent_id AND i.account_id=NEW.account_id AND i.operation_kind='sell' AND i.qty_unit='base' AND i.calculation_id IS NULL) THEN
    RAISE EXCEPTION 'A sale intent is required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER disposal_read_intent_kind BEFORE INSERT ON harborline.disposal_reads FOR EACH ROW EXECUTE FUNCTION harborline.require_disposal_intent();
--> statement-breakpoint
REVOKE ALL ON FUNCTION harborline.require_disposal_intent() FROM PUBLIC,harborline_app,harborline_key_store;
--> statement-breakpoint
GRANT USAGE,SELECT ON SEQUENCE harborline.disposal_reads_sequence_seq TO harborline_app;
