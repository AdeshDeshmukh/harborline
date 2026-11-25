CREATE TYPE "harborline"."intent_state" AS ENUM('DRAFT', 'PREPARING', 'REVIEW_READY', 'SUBMITTING', 'PENDING', 'COMPLETE', 'EXPIRED', 'REJECTED', 'ABANDONED', 'UNKNOWN', 'FAILED', 'CANCELED', 'MANUAL_REVIEW');--> statement-breakpoint
CREATE TYPE "harborline"."operation_kind" AS ENUM('buy', 'sell', 'exit');--> statement-breakpoint
CREATE TYPE "harborline"."preparation_safety" AS ENUM('unverified', 'contract_fixture');--> statement-breakpoint
CREATE TYPE "harborline"."quantity_unit" AS ENUM('base', 'quote');--> statement-breakpoint
CREATE TABLE "harborline"."audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"intent_id" uuid,
	"actor_id" uuid,
	"sequence" bigserial NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"redacted_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "audit_metadata_bounded" CHECK (jsonb_typeof("harborline"."audit_events"."redacted_metadata")='object' AND octet_length("harborline"."audit_events"."redacted_metadata"::text)<=4096),
	CONSTRAINT "audit_event_type_valid" CHECK ("harborline"."audit_events"."event_type" ~ '^[a-z][a-z0-9_]{0,63}$' AND isfinite("harborline"."audit_events"."occurred_at"))
);
--> statement-breakpoint
ALTER TABLE "harborline"."audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "harborline"."investment_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"operation_kind" "harborline"."operation_kind" NOT NULL,
	"asset_id" uuid NOT NULL,
	"requested_qty" numeric(38, 18) NOT NULL,
	"qty_unit" "harborline"."quantity_unit" NOT NULL,
	"calculation_id" uuid,
	"policy_revision" integer NOT NULL,
	"request_key" varchar(64) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"state" "harborline"."intent_state" DEFAULT 'DRAFT' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"preparation_generation" integer DEFAULT 0 NOT NULL,
	"preparation_lease_until" timestamp with time zone,
	"review_expires_at" timestamp with time zone,
	"provider_order_id" varchar(128),
	"preparation_safety" "harborline"."preparation_safety" DEFAULT 'unverified' NOT NULL,
	"effects_possible" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_intents_provider_order_id_unique" UNIQUE("provider_order_id"),
	CONSTRAINT "intent_account_identity" UNIQUE("id","account_id"),
	CONSTRAINT "intent_account_request_key" UNIQUE("account_id","request_key"),
	CONSTRAINT "intent_quantity_valid" CHECK ("harborline"."investment_intents"."requested_qty">0 AND "harborline"."investment_intents"."requested_qty"<>'NaN'::numeric),
	CONSTRAINT "intent_request_key_valid" CHECK ("harborline"."investment_intents"."request_key" ~ '^[A-Za-z0-9_-]{1,64}$' AND "harborline"."investment_intents"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "intent_revisions_valid" CHECK ("harborline"."investment_intents"."revision">=1 AND "harborline"."investment_intents"."policy_revision">=1 AND "harborline"."investment_intents"."preparation_generation">=0),
	CONSTRAINT "intent_units_valid" CHECK (("harborline"."investment_intents"."operation_kind"='buy' AND "harborline"."investment_intents"."qty_unit"='quote' AND "harborline"."investment_intents"."calculation_id" IS NOT NULL) OR ("harborline"."investment_intents"."operation_kind"<>'buy' AND "harborline"."investment_intents"."qty_unit"='base')),
	CONSTRAINT "intent_cash_precision" CHECK ("harborline"."investment_intents"."operation_kind"='sell' OR "harborline"."investment_intents"."requested_qty"=trunc("harborline"."investment_intents"."requested_qty",6)),
	CONSTRAINT "intent_draft_unstarted" CHECK ("harborline"."investment_intents"."state"<>'DRAFT' OR ("harborline"."investment_intents"."preparation_generation"=0 AND "harborline"."investment_intents"."provider_order_id" IS NULL AND NOT "harborline"."investment_intents"."effects_possible")),
	CONSTRAINT "intent_preparation_lease" CHECK ("harborline"."investment_intents"."state"<>'PREPARING' OR ("harborline"."investment_intents"."preparation_lease_until" IS NOT NULL AND "harborline"."investment_intents"."preparation_generation">0)),
	CONSTRAINT "intent_review_fields" CHECK ("harborline"."investment_intents"."state"<>'REVIEW_READY' OR ("harborline"."investment_intents"."provider_order_id" IS NOT NULL AND "harborline"."investment_intents"."review_expires_at" IS NOT NULL)),
	CONSTRAINT "intent_fixture_states" CHECK ("harborline"."investment_intents"."state" NOT IN ('REVIEW_READY','SUBMITTING') OR "harborline"."investment_intents"."preparation_safety"='contract_fixture'),
	CONSTRAINT "intent_effects_fenced" CHECK ("harborline"."investment_intents"."state" NOT IN ('SUBMITTING','PENDING','UNKNOWN','COMPLETE','FAILED','CANCELED','MANUAL_REVIEW') OR "harborline"."investment_intents"."effects_possible"),
	CONSTRAINT "intent_timestamps_finite" CHECK (isfinite("harborline"."investment_intents"."created_at") AND isfinite("harborline"."investment_intents"."updated_at") AND ("harborline"."investment_intents"."preparation_lease_until" IS NULL OR isfinite("harborline"."investment_intents"."preparation_lease_until")) AND ("harborline"."investment_intents"."review_expires_at" IS NULL OR isfinite("harborline"."investment_intents"."review_expires_at"))),
	CONSTRAINT "intent_provider_id_valid" CHECK ("harborline"."investment_intents"."provider_order_id" IS NULL OR "harborline"."investment_intents"."provider_order_id" ~ '^[A-Za-z0-9_-]{1,128}$')
);
--> statement-breakpoint
ALTER TABLE "harborline"."investment_intents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "harborline"."calculation_snapshots" ADD CONSTRAINT "calculation_snapshot_account_identity" UNIQUE("id","account_id");--> statement-breakpoint
ALTER TABLE "harborline"."audit_events" ADD CONSTRAINT "audit_events_account_id_gateway_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "harborline"."gateway_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."audit_events" ADD CONSTRAINT "audit_events_actor_id_profiles_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "harborline"."profiles"("auth_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."audit_events" ADD CONSTRAINT "audit_owned_intent_fk" FOREIGN KEY ("intent_id","account_id") REFERENCES "harborline"."investment_intents"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."investment_intents" ADD CONSTRAINT "investment_intents_account_id_gateway_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "harborline"."gateway_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."investment_intents" ADD CONSTRAINT "intent_owned_calculation_fk" FOREIGN KEY ("calculation_id","account_id") REFERENCES "harborline"."calculation_snapshots"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_account_intent_sequence" ON "harborline"."audit_events" USING btree ("account_id","intent_id","sequence");--> statement-breakpoint
CREATE INDEX "intent_account_created" ON "harborline"."investment_intents" USING btree ("account_id","created_at");--> statement-breakpoint
ALTER TABLE "harborline"."gateway_accounts" ADD CONSTRAINT "account_owned_active_operation_fk" FOREIGN KEY ("active_operation_id","id") REFERENCES "harborline"."investment_intents"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "audit_events_owner" ON "harborline"."audit_events" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."audit_events"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (("harborline"."audit_events"."actor_id" IS NULL OR "harborline"."audit_events"."actor_id"=nullif(current_setting('harborline.owner_id', true), '')::uuid) AND exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."audit_events"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "investment_intents_owner" ON "harborline"."investment_intents" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."investment_intents"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."investment_intents"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE harborline.investment_intents FORCE ROW LEVEL SECURITY;
ALTER TABLE harborline.audit_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON harborline.investment_intents,harborline.audit_events FROM PUBLIC,harborline_key_store,harborline_app;
GRANT SELECT,INSERT ON harborline.investment_intents,harborline.audit_events TO harborline_app;
GRANT UPDATE(state,revision,preparation_generation,preparation_lease_until,review_expires_at,provider_order_id,effects_possible,updated_at) ON harborline.investment_intents TO harborline_app;
REVOKE ALL ON SEQUENCE harborline.audit_events_sequence_seq FROM PUBLIC,harborline_key_store,harborline_app;
GRANT USAGE ON SEQUENCE harborline.audit_events_sequence_seq TO harborline_app;
--> statement-breakpoint
CREATE FUNCTION harborline.enforce_intent_fences() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.effects_possible AND NOT NEW.effects_possible) OR NEW.revision <> OLD.revision + 1
     OR NEW.preparation_generation < OLD.preparation_generation OR NEW.preparation_generation > OLD.preparation_generation + 1
     OR (OLD.state IN ('COMPLETE','FAILED','CANCELED','EXPIRED','REJECTED','ABANDONED') AND NEW.state <> OLD.state)
     OR (NEW.state='SUBMITTING' AND (OLD.state<>'REVIEW_READY' OR OLD.effects_possible))
     OR (OLD.effects_possible AND NEW.state IN ('DRAFT','PREPARING','REVIEW_READY','EXPIRED','REJECTED','ABANDONED')) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Intent safety fence violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION harborline.enforce_intent_fences() FROM PUBLIC;
CREATE TRIGGER intent_safety_fences BEFORE UPDATE ON harborline.investment_intents FOR EACH ROW EXECUTE FUNCTION harborline.enforce_intent_fences();
