CREATE TABLE "harborline"."execution_dispatches" (
	"attempt_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"source" varchar(32) NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dispatch_fixture_valid" CHECK ("harborline"."execution_dispatches"."source"='contract_fixture' AND isfinite("harborline"."execution_dispatches"."claimed_at"))
);
--> statement-breakpoint
ALTER TABLE "harborline"."execution_dispatches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "harborline"."execution_attempts" ADD CONSTRAINT "attempt_owned_identity" UNIQUE("id","intent_id","account_id");--> statement-breakpoint
ALTER TABLE "harborline"."execution_dispatches" ADD CONSTRAINT "dispatch_owned_attempt_fk" FOREIGN KEY ("attempt_id","intent_id","account_id") REFERENCES "harborline"."execution_attempts"("id","intent_id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "execution_dispatches_owner" ON "harborline"."execution_dispatches" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."execution_dispatches"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."execution_dispatches"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE harborline.execution_dispatches FORCE ROW LEVEL SECURITY;
REVOKE ALL ON harborline.execution_dispatches FROM PUBLIC,harborline_key_store,harborline_app;
GRANT SELECT,INSERT ON harborline.execution_dispatches TO harborline_app;
