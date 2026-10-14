ALTER TABLE "floraclin"."whatsapp_messages" ADD COLUMN IF NOT EXISTS "pricing_category" varchar(30);--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_messages" ADD COLUMN IF NOT EXISTS "pricing_type" varchar(40);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floraclin"."whatsapp_credit_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"credit_period_id" uuid NOT NULL,
	"meta_message_id" varchar(255) NOT NULL,
	"cost" integer NOT NULL,
	"refunded_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_credit_charges" ADD CONSTRAINT "whatsapp_credit_charges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_credit_charges" ADD CONSTRAINT "whatsapp_credit_charges_credit_period_id_whatsapp_credits_id_fk" FOREIGN KEY ("credit_period_id") REFERENCES "floraclin"."whatsapp_credits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_whatsapp_credit_charges_meta_message" ON "floraclin"."whatsapp_credit_charges" USING btree ("meta_message_id");--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_credit_charges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "floraclin"."plans"
SET "limits" = ("limits" - 'whatsapp_conversations') || jsonb_build_object('whatsapp_credits', "limits"->'whatsapp_conversations')
WHERE "limits" ? 'whatsapp_conversations';
