-- Generated schema plus explicitly reviewed grants/FORCE RLS below.
CREATE TYPE "harborline"."commitment_status" AS ENUM('outstanding', 'paid', 'removed');--> statement-breakpoint
CREATE TABLE "harborline"."commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"label" varchar(120) NOT NULL,
	"amount" numeric(38, 18) NOT NULL,
	"due_date" date NOT NULL,
	"status" "harborline"."commitment_status" DEFAULT 'outstanding' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "commitment_label_nonempty" CHECK (length(trim("harborline"."commitments"."label")) > 0 AND "harborline"."commitments"."label" !~ '[[:cntrl:]]'),
	CONSTRAINT "commitment_amount_valid" CHECK ("harborline"."commitments"."amount" > 0 AND "harborline"."commitments"."amount" <> 'NaN'::numeric AND "harborline"."commitments"."amount" = trunc("harborline"."commitments"."amount", 2)),
	CONSTRAINT "commitment_date_range" CHECK ("harborline"."commitments"."due_date" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
	CONSTRAINT "commitment_revision_positive" CHECK ("harborline"."commitments"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "harborline"."commitments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "harborline"."planning_policies" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"horizon_days" integer NOT NULL,
	"additional_buffer" numeric(38, 18) NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"acknowledged_at" timestamp with time zone NOT NULL,
	CONSTRAINT "planning_horizon_range" CHECK ("harborline"."planning_policies"."horizon_days" BETWEEN 1 AND 90),
	CONSTRAINT "planning_buffer_valid" CHECK ("harborline"."planning_policies"."additional_buffer" >= 0 AND "harborline"."planning_policies"."additional_buffer" <> 'NaN'::numeric AND "harborline"."planning_policies"."additional_buffer" = trunc("harborline"."planning_policies"."additional_buffer", 2)),
	CONSTRAINT "planning_revision_positive" CHECK ("harborline"."planning_policies"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "harborline"."planning_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "harborline"."commitments" ADD CONSTRAINT "commitments_account_id_planning_policies_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "harborline"."planning_policies"("account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."planning_policies" ADD CONSTRAINT "planning_policies_account_id_gateway_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "harborline"."gateway_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commitments_account_due_date" ON "harborline"."commitments" USING btree ("account_id","due_date");--> statement-breakpoint
CREATE POLICY "commitments_owner" ON "harborline"."commitments" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists (select 1 from harborline.gateway_accounts a where a.id = "harborline"."commitments"."account_id" and a.owner_id = nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists (select 1 from harborline.gateway_accounts a where a.id = "harborline"."commitments"."account_id" and a.owner_id = nullif(current_setting('harborline.owner_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "planning_policies_owner" ON "harborline"."planning_policies" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists (select 1 from harborline.gateway_accounts a where a.id = "harborline"."planning_policies"."account_id" and a.owner_id = nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists (select 1 from harborline.gateway_accounts a where a.id = "harborline"."planning_policies"."account_id" and a.owner_id = nullif(current_setting('harborline.owner_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE harborline.planning_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE harborline.commitments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON harborline.planning_policies, harborline.commitments FROM PUBLIC;
REVOKE ALL ON harborline.planning_policies, harborline.commitments FROM harborline_key_store;
REVOKE ALL ON harborline.planning_policies, harborline.commitments FROM harborline_app;
GRANT SELECT, INSERT, UPDATE ON harborline.planning_policies, harborline.commitments TO harborline_app;
