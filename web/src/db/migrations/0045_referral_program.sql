-- Referral program ("Indique e Ganhe"). Additive only: safe to apply before
-- the deploy that uses it; the running code ignores every object below.
ALTER TABLE "floraclin"."tenants" ADD COLUMN IF NOT EXISTS "referral_code" varchar(12);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tenants_referral_code" ON "floraclin"."tenants" USING btree ("referral_code");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floraclin"."tenant_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_tenant_id" uuid NOT NULL,
	"referred_tenant_id" uuid NOT NULL,
	"code" varchar(12) NOT NULL,
	"captured_via" varchar(12) NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"status" varchar(16) NOT NULL,
	"paused_reason" varchar(16),
	"ineligible_reason" varchar(32),
	"checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stripe_subscription_id" varchar(255),
	"first_paid_at" timestamp with time zone,
	"qualified_at" timestamp with time zone,
	"qualifying_invoice_id" varchar(255),
	"ended_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_referrals_referrer_tenant_id_tenants_id_fk" FOREIGN KEY ("referrer_tenant_id") REFERENCES "floraclin"."tenants"("id"),
	CONSTRAINT "tenant_referrals_referred_tenant_id_tenants_id_fk" FOREIGN KEY ("referred_tenant_id") REFERENCES "floraclin"."tenants"("id"),
	CONSTRAINT "tenant_referrals_referred_unique" UNIQUE ("referred_tenant_id"),
	CONSTRAINT "tenant_referrals_not_self_check" CHECK ("referrer_tenant_id" <> "referred_tenant_id"),
	CONSTRAINT "tenant_referrals_status_check" CHECK ("status" IN ('trial','trial_ended','first_paid','counting','paused','canceled','ineligible')),
	CONSTRAINT "tenant_referrals_captured_via_check" CHECK ("captured_via" IN ('link','signup_field','billing_page')),
	CONSTRAINT "tenant_referrals_paused_reason_check" CHECK ("paused_reason" IS NULL OR "paused_reason" IN ('past_due','cancel_scheduled')),
	CONSTRAINT "tenant_referrals_ineligible_reason_check" CHECK ("ineligible_reason" IS NULL OR "ineligible_reason" IN ('self_referral','not_new','chargeback','admin'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_referrals_referrer_status" ON "floraclin"."tenant_referrals" USING btree ("referrer_tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_referrals_stripe_sub" ON "floraclin"."tenant_referrals" USING btree ("stripe_subscription_id");--> statement-breakpoint
ALTER TABLE "floraclin"."tenant_referrals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floraclin"."referral_reward_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_tenant_id" uuid NOT NULL,
	"counting" integer NOT NULL,
	"discount_percent" integer NOT NULL,
	"bonus_credits" integer NOT NULL,
	"stripe_subscription_id" varchar(255),
	"reason" varchar(32) NOT NULL,
	"referral_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_reward_events_referrer_tenant_id_tenants_id_fk" FOREIGN KEY ("referrer_tenant_id") REFERENCES "floraclin"."tenants"("id"),
	CONSTRAINT "referral_reward_events_referral_id_fk" FOREIGN KEY ("referral_id") REFERENCES "floraclin"."tenant_referrals"("id"),
	CONSTRAINT "referral_reward_events_percent_check" CHECK ("discount_percent" IN (0,20,40,60,80,100))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_referral_reward_events_referrer_created" ON "floraclin"."referral_reward_events" USING btree ("referrer_tenant_id","created_at");--> statement-breakpoint
ALTER TABLE "floraclin"."referral_reward_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floraclin"."billing_card_fingerprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "billing_card_fingerprints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id")
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_card_fingerprints_tenant_fp" ON "floraclin"."billing_card_fingerprints" USING btree ("tenant_id","fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_billing_card_fingerprints_fp" ON "floraclin"."billing_card_fingerprints" USING btree ("fingerprint");--> statement-breakpoint
ALTER TABLE "floraclin"."billing_card_fingerprints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_credits" ADD COLUMN IF NOT EXISTS "bonus_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_credits" ADD COLUMN IF NOT EXISTS "bonus_source" varchar(16);
