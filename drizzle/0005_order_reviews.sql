CREATE TABLE "harborline"."order_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"terms" jsonb NOT NULL,
	"terms_hash" varchar(64) NOT NULL,
	"maximum_debit" numeric(38, 18) NOT NULL,
	"payloads_encrypted" "bytea" NOT NULL,
	"nonce" "bytea" NOT NULL,
	"tag" "bytea" NOT NULL,
	"encryption_key_version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "review_intent_revision" UNIQUE("intent_id","revision"),
	CONSTRAINT "review_positive_revisions" CHECK ("harborline"."order_reviews"."revision">0 AND "harborline"."order_reviews"."encryption_key_version">0),
	CONSTRAINT "review_terms_bounded" CHECK (jsonb_typeof("harborline"."order_reviews"."terms")='object' AND octet_length("harborline"."order_reviews"."terms"::text)<=65536 AND "harborline"."order_reviews"."terms_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "review_debit_valid" CHECK ("harborline"."order_reviews"."maximum_debit">0 AND "harborline"."order_reviews"."maximum_debit"<>'NaN'::numeric AND "harborline"."order_reviews"."maximum_debit"=trunc("harborline"."order_reviews"."maximum_debit",6)),
	CONSTRAINT "review_ciphertext_bounded" CHECK (octet_length("harborline"."order_reviews"."payloads_encrypted") BETWEEN 1 AND 2200000 AND octet_length("harborline"."order_reviews"."nonce")=12 AND octet_length("harborline"."order_reviews"."tag")=16),
	CONSTRAINT "review_expiry_bounded" CHECK (isfinite("harborline"."order_reviews"."created_at") AND isfinite("harborline"."order_reviews"."expires_at") AND "harborline"."order_reviews"."expires_at">"harborline"."order_reviews"."created_at" AND "harborline"."order_reviews"."expires_at"<="harborline"."order_reviews"."created_at"+interval '20 seconds')
);
--> statement-breakpoint
ALTER TABLE "harborline"."order_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "harborline"."order_reviews" ADD CONSTRAINT "review_owned_intent_fk" FOREIGN KEY ("intent_id","account_id") REFERENCES "harborline"."investment_intents"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "order_reviews_owner" ON "harborline"."order_reviews" AS PERMISSIVE FOR ALL TO "harborline_app" USING (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."order_reviews"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid)) WITH CHECK (exists(select 1 from harborline.gateway_accounts a where a.id="harborline"."order_reviews"."account_id" and a.owner_id=nullif(current_setting('harborline.owner_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE harborline.order_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON harborline.order_reviews FROM PUBLIC,harborline_key_store,harborline_app;
GRANT SELECT,INSERT ON harborline.order_reviews TO harborline_app;
