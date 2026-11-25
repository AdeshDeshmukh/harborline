CREATE TABLE "harborline"."balance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"sequence" bigserial NOT NULL,
	"source" varchar(16) NOT NULL,
	"listing_id" varchar(120) NOT NULL,
	"chain" varchar(120) NOT NULL,
	"venue" varchar(120) NOT NULL,
	"available" numeric(38, 18) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "balance_snapshot_account_identity" UNIQUE("id","account_id"),
	CONSTRAINT "balance_snapshot_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "balance_fixture_only" CHECK ("harborline"."balance_snapshots"."source" = 'fixture'),
	CONSTRAINT "balance_available_valid" CHECK ("harborline"."balance_snapshots"."available" >= 0 AND "harborline"."balance_snapshots"."available" <> 'NaN'::numeric),
	CONSTRAINT "balance_observed_finite" CHECK (isfinite("harborline"."balance_snapshots"."observed_at")),
	CONSTRAINT "balance_identity_nonempty" CHECK (length(trim("harborline"."balance_snapshots"."listing_id")) > 0 AND length(trim("harborline"."balance_snapshots"."chain")) > 0 AND length(trim("harborline"."balance_snapshots"."venue")) > 0)
);
--> statement-breakpoint
ALTER TABLE "harborline"."balance_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "harborline"."calculation_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"balance_snapshot_id" uuid NOT NULL,
	"policy_revision" integer NOT NULL,
	"formula_version" integer NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"horizon_end" date NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "calculation_revision_positive" CHECK ("harborline"."calculation_snapshots"."policy_revision" >= 1),
	CONSTRAINT "calculation_formula_supported" CHECK ("harborline"."calculation_snapshots"."formula_version" = 1),
	CONSTRAINT "calculation_input_object" CHECK (jsonb_typeof("harborline"."calculation_snapshots"."input") = 'object'),
	CONSTRAINT "calculation_result_object" CHECK (jsonb_typeof("harborline"."calculation_snapshots"."result") = 'object'),
	CONSTRAINT "calculation_date_range" CHECK ("harborline"."calculation_snapshots"."horizon_end" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
	CONSTRAINT "calculation_created_finite" CHECK (isfinite("harborline"."calculation_snapshots"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "harborline"."calculation_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "harborline"."balance_snapshots" ADD CONSTRAINT "balance_snapshots_account_id_gateway_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "harborline"."gateway_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."calculation_snapshots" ADD CONSTRAINT "calculation_snapshots_account_id_gateway_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "harborline"."gateway_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."calculation_snapshots" ADD CONSTRAINT "calculation_owned_balance_fk" FOREIGN KEY ("balance_snapshot_id","account_id") REFERENCES "harborline"."balance_snapshots"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balance_snapshot_account_sequence" ON "harborline"."balance_snapshots" USING btree ("account_id","sequence");--> statement-breakpoint
CREATE INDEX "calculation_snapshot_account" ON "harborline"."calculation_snapshots" USING btree ("account_id");--> statement-breakpoint
CREATE POLICY "balance_snapshots_owner" ON "harborline"."balance_snapshots" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists (select 1 from harborline.gateway_accounts a where a.id = "harborline"."balance_snapshots"."account_id" and a.owner_id = nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists (select 1 from harborline.gateway_accounts a where a.id = "harborline"."balance_snapshots"."account_id" and a.owner_id = nullif(current_setting('harborline.owner_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "calculation_snapshots_owner" ON "harborline"."calculation_snapshots" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists (select 1 from harborline.gateway_accounts a where a.id = "harborline"."calculation_snapshots"."account_id" and a.owner_id = nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists (select 1 from harborline.gateway_accounts a where a.id = "harborline"."calculation_snapshots"."account_id" and a.owner_id = nullif(current_setting('harborline.owner_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE harborline.balance_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE harborline.calculation_snapshots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON harborline.balance_snapshots, harborline.calculation_snapshots FROM PUBLIC, harborline_key_store, harborline_app;
GRANT SELECT, INSERT ON harborline.balance_snapshots, harborline.calculation_snapshots TO harborline_app;
REVOKE ALL ON SEQUENCE harborline.balance_snapshots_sequence_seq FROM PUBLIC, harborline_key_store, harborline_app;
GRANT USAGE ON SEQUENCE harborline.balance_snapshots_sequence_seq TO harborline_app;
