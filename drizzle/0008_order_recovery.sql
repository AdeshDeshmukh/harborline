CREATE TABLE "harborline"."order_recovery_observations" (
	"read_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"disposition" varchar(16) NOT NULL,
	"evidence" jsonb,
	"observation_hash" varchar(64) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"source" varchar(32) NOT NULL,
	CONSTRAINT "recovery_observation_valid" CHECK ("harborline"."order_recovery_observations"."source"='contract_fixture' AND "harborline"."order_recovery_observations"."kind" IN ('observed','initialized','unavailable','not_found','invalid_response') AND "harborline"."order_recovery_observations"."disposition" IN ('applied','ignored','conflict') AND "harborline"."order_recovery_observations"."observation_hash" ~ '^[0-9a-f]{64}$' AND isfinite("harborline"."order_recovery_observations"."observed_at") AND ("harborline"."order_recovery_observations"."evidence" IS NULL OR (jsonb_typeof("harborline"."order_recovery_observations"."evidence")='object' AND octet_length("harborline"."order_recovery_observations"."evidence"::text)<=4096)))
);
--> statement-breakpoint
ALTER TABLE "harborline"."order_recovery_observations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "harborline"."order_recovery_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"sequence" bigserial NOT NULL,
	"intent_revision" integer NOT NULL,
	"binding" jsonb NOT NULL,
	"source" varchar(32) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recovery_read_owned_identity" UNIQUE("id","intent_id","account_id"),
	CONSTRAINT "recovery_read_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "recovery_read_valid" CHECK ("harborline"."order_recovery_reads"."source"='contract_fixture' AND "harborline"."order_recovery_reads"."intent_revision">0 AND isfinite("harborline"."order_recovery_reads"."started_at") AND jsonb_typeof("harborline"."order_recovery_reads"."binding")='object' AND octet_length("harborline"."order_recovery_reads"."binding"::text)<=2048)
);
--> statement-breakpoint
ALTER TABLE "harborline"."order_recovery_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "harborline"."order_recovery_observations" ADD CONSTRAINT "recovery_observation_owned_read_fk" FOREIGN KEY ("read_id","intent_id","account_id") REFERENCES "harborline"."order_recovery_reads"("id","intent_id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."order_recovery_reads" ADD CONSTRAINT "recovery_owned_attempt_fk" FOREIGN KEY ("attempt_id","intent_id","account_id") REFERENCES "harborline"."execution_attempts"("id","intent_id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recovery_observation_intent" ON "harborline"."order_recovery_observations" USING btree ("account_id","intent_id");--> statement-breakpoint
CREATE INDEX "recovery_read_intent_sequence" ON "harborline"."order_recovery_reads" USING btree ("account_id","intent_id","sequence");--> statement-breakpoint
CREATE POLICY "order_recovery_observations_owner" ON "harborline"."order_recovery_observations" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."order_recovery_observations"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."order_recovery_observations"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "order_recovery_reads_owner" ON "harborline"."order_recovery_reads" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."order_recovery_reads"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."order_recovery_reads"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE harborline.order_recovery_reads FORCE ROW LEVEL SECURITY;
ALTER TABLE harborline.order_recovery_observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON harborline.order_recovery_reads,harborline.order_recovery_observations FROM PUBLIC,harborline_key_store,harborline_app;
GRANT SELECT,INSERT ON harborline.order_recovery_reads,harborline.order_recovery_observations TO harborline_app;
GRANT USAGE ON SEQUENCE harborline.order_recovery_reads_sequence_seq TO harborline_app;
