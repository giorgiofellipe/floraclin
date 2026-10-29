-- Old referral codes keep working (PR #96 follow-up). When a clinic changes its
-- code, the previous one is stored here and still resolves to that clinic; no
-- other clinic can claim it. Additive only: safe to apply before the deploy that
-- uses it. Codes are stored normalised (uppercase A-Z0-9), so the primary key is
-- the case-insensitive uniqueness check across all retired codes.
CREATE TABLE IF NOT EXISTS "floraclin"."referral_code_aliases" (
	"code" varchar(12) PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_code_aliases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_referral_code_aliases_tenant" ON "floraclin"."referral_code_aliases" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "floraclin"."referral_code_aliases" ENABLE ROW LEVEL SECURITY;
