CREATE TABLE "harborline"."execution_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"source" varchar(32) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "attempt_one_per_intent" UNIQUE("intent_id"),
	CONSTRAINT "attempt_one_per_approval" UNIQUE("approval_id"),
	CONSTRAINT "attempt_fixture_valid" CHECK ("harborline"."execution_attempts"."source"='contract_fixture' AND isfinite("harborline"."execution_attempts"."started_at"))
);
--> statement-breakpoint
ALTER TABLE "harborline"."execution_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "harborline"."order_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"review_revision" integer NOT NULL,
	"terms_hash" varchar(64) NOT NULL,
	"balance_snapshot_id" uuid NOT NULL,
	"source" varchar(32) NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "approval_intent_review" UNIQUE("intent_id","review_revision"),
	CONSTRAINT "approval_owned_identity" UNIQUE("id","intent_id","account_id"),
	CONSTRAINT "approval_fixture_valid" CHECK ("harborline"."order_approvals"."source"='contract_fixture' AND "harborline"."order_approvals"."review_revision">0 AND "harborline"."order_approvals"."terms_hash" ~ '^[0-9a-f]{64}$' AND isfinite("harborline"."order_approvals"."approved_at"))
);
--> statement-breakpoint
ALTER TABLE "harborline"."order_approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "harborline"."execution_attempts" ADD CONSTRAINT "attempt_owned_approval_fk" FOREIGN KEY ("approval_id","intent_id","account_id") REFERENCES "harborline"."order_approvals"("id","intent_id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."order_approvals" ADD CONSTRAINT "order_approvals_owner_id_profiles_auth_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "harborline"."profiles"("auth_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."order_approvals" ADD CONSTRAINT "approval_owned_intent_fk" FOREIGN KEY ("intent_id","account_id") REFERENCES "harborline"."investment_intents"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."order_approvals" ADD CONSTRAINT "approval_review_fk" FOREIGN KEY ("intent_id","review_revision") REFERENCES "harborline"."order_reviews"("intent_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harborline"."order_approvals" ADD CONSTRAINT "approval_owned_balance_fk" FOREIGN KEY ("balance_snapshot_id","account_id") REFERENCES "harborline"."balance_snapshots"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "execution_attempts_owner" ON "harborline"."execution_attempts" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."execution_attempts"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."execution_attempts"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "order_approvals_owner" ON "harborline"."order_approvals" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."order_approvals"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK ("harborline"."order_approvals"."owner_id"=nullif(current_setting('harborline.owner_id', true), '')::uuid AND exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."order_approvals"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE harborline.order_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE harborline.execution_attempts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON harborline.order_approvals,harborline.execution_attempts FROM PUBLIC,harborline_key_store,harborline_app;
GRANT SELECT,INSERT ON harborline.order_approvals,harborline.execution_attempts TO harborline_app;
