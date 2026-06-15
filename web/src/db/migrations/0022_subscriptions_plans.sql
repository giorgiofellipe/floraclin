CREATE TABLE IF NOT EXISTS "floraclin"."plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"billing_interval" varchar(20) DEFAULT 'month' NOT NULL,
	"trial_days" integer,
	"stripe_price_id" varchar(255),
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
INSERT INTO "floraclin"."plans" ("slug", "name", "price_cents", "trial_days", "limits", "features", "display_order") VALUES
	('free', 'Gratuito', 0, 14, '{"whatsapp_conversations": 50, "users": 2, "patients": 100}'::jsonb, '{"own_whatsapp_number": false}'::jsonb, 0),
	('starter', 'Starter', 9900, NULL, '{"whatsapp_conversations": 300, "users": 5, "patients": -1}'::jsonb, '{"own_whatsapp_number": true}'::jsonb, 1),
	('pro', 'Pro', 19900, NULL, '{"whatsapp_conversations": 1000, "users": -1, "patients": -1}'::jsonb, '{"own_whatsapp_number": true}'::jsonb, 2)
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floraclin"."tenant_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'trialing' NOT NULL,
	"stripe_customer_id" varchar(255),
	"stripe_subscription_id" varchar(255),
	"current_period_start" timestamp with time zone DEFAULT now() NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"canceled_at" timestamp with time zone,
	"source" varchar(20) DEFAULT 'trial' NOT NULL,
	"gifted_by" uuid,
	"gifted_months" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_subscriptions_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "floraclin"."tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "floraclin"."tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "floraclin"."plans"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "floraclin"."tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_gifted_by_users_id_fk" FOREIGN KEY ("gifted_by") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "floraclin"."tenant_subscriptions" ("tenant_id", "plan_id", "status", "current_period_start", "current_period_end", "source")
SELECT t."id", p."id", 'trialing', now(), now() + interval '14 days', 'trial'
FROM "floraclin"."tenants" t
CROSS JOIN "floraclin"."plans" p
WHERE p."slug" = 'free'
  AND t."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "floraclin"."tenant_subscriptions" ts WHERE ts."tenant_id" = t."id"
  );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floraclin"."whatsapp_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"credits_total" integer NOT NULL,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_credits" ADD CONSTRAINT "whatsapp_credits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_whatsapp_credits_tenant_period" ON "floraclin"."whatsapp_credits" USING btree ("tenant_id","period_start");
--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_templates" ADD COLUMN IF NOT EXISTS "system_template" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "floraclin"."tenants"
SET settings = settings || '{"whatsapp_mode": "own"}'::jsonb
WHERE deleted_at IS NULL
  AND settings->>'whatsapp_phone_number_id' IS NOT NULL
  AND settings->>'whatsapp_access_token' IS NOT NULL
  AND (settings->>'whatsapp_mode' IS NULL OR settings->>'whatsapp_mode' = '');
