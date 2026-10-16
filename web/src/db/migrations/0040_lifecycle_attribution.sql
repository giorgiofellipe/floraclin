ALTER TABLE "floraclin"."tenant_lifecycle_messages" ADD COLUMN IF NOT EXISTS "provider_message_id" varchar(255);--> statement-breakpoint
ALTER TABLE "floraclin"."tenant_lifecycle_messages" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "floraclin"."tenant_lifecycle_messages" ADD COLUMN IF NOT EXISTS "read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "floraclin"."tenant_lifecycle_messages" ADD COLUMN IF NOT EXISTS "error_code" varchar(50);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floraclin"."tenant_lifecycle_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lifecycle_message_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_lifecycle_clicks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id"),
	CONSTRAINT "tenant_lifecycle_clicks_message_id_fk" FOREIGN KEY ("lifecycle_message_id") REFERENCES "floraclin"."tenant_lifecycle_messages"("id") ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_lifecycle_clicks_tenant_created" ON "floraclin"."tenant_lifecycle_clicks" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_lifecycle_clicks_message_created" ON "floraclin"."tenant_lifecycle_clicks" USING btree ("lifecycle_message_id","created_at");--> statement-breakpoint
ALTER TABLE "floraclin"."tenant_lifecycle_clicks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Backfilled values predate any click, so they never change attribution.
ALTER TABLE "floraclin"."tenant_subscriptions" ADD COLUMN IF NOT EXISTS "first_paid_at" timestamp with time zone;--> statement-breakpoint
UPDATE "floraclin"."tenant_subscriptions" SET "first_paid_at" = "updated_at" WHERE "source" = 'stripe' AND "first_paid_at" IS NULL;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_automations" ADD COLUMN IF NOT EXISTS "first_enabled_at" timestamp with time zone;--> statement-breakpoint
UPDATE "floraclin"."whatsapp_automations" SET "first_enabled_at" = "updated_at" WHERE "enabled" AND "first_enabled_at" IS NULL;
