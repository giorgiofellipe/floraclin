CREATE TABLE "floraclin"."prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255),
	"phone" varchar(30) NOT NULL,
	"source" varchar(50) DEFAULT 'whatsapp' NOT NULL,
	"stage" varchar(20) DEFAULT 'novo' NOT NULL,
	"intent" varchar(50),
	"interested_procedure" varchar(255),
	"sentiment" varchar(20),
	"ai_tags" jsonb DEFAULT '[]'::jsonb,
	"lost_reason" text,
	"assigned_user_id" uuid,
	"converted_patient_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "floraclin"."sse_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floraclin"."whatsapp_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"phone_number" varchar(30) NOT NULL,
	"profile_name" varchar(255),
	"prospect_id" uuid,
	"patient_id" uuid,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_body" text,
	"last_inbound_at" timestamp with time zone,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floraclin"."whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" varchar(10) NOT NULL,
	"meta_message_id" varchar(255),
	"body" text,
	"media_type" varchar(20),
	"media_url" text,
	"media_filename" varchar(500),
	"template_name" varchar(255),
	"delivery_status" varchar(20) DEFAULT 'sent' NOT NULL,
	"error_code" varchar(50),
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floraclin"."whatsapp_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"meta_template_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"language" varchar(10) NOT NULL,
	"category" varchar(50) NOT NULL,
	"status" varchar(20) NOT NULL,
	"components" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "floraclin"."prospects" ADD CONSTRAINT "prospects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."prospects" ADD CONSTRAINT "prospects_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."prospects" ADD CONSTRAINT "prospects_converted_patient_id_patients_id_fk" FOREIGN KEY ("converted_patient_id") REFERENCES "floraclin"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."sse_events" ADD CONSTRAINT "sse_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "floraclin"."prospects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "floraclin"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversation_id_whatsapp_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "floraclin"."whatsapp_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_prospects_tenant_stage" ON "floraclin"."prospects" USING btree ("tenant_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_prospects_tenant_phone" ON "floraclin"."prospects" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE INDEX "idx_sse_events_tenant_created" ON "floraclin"."sse_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_whatsapp_conversations_tenant_phone" ON "floraclin"."whatsapp_conversations" USING btree ("tenant_id","phone_number");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_conversations_tenant_last_msg" ON "floraclin"."whatsapp_conversations" USING btree ("tenant_id","last_message_at");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_messages_conversation_ts" ON "floraclin"."whatsapp_messages" USING btree ("conversation_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_whatsapp_messages_meta_id" ON "floraclin"."whatsapp_messages" USING btree ("meta_message_id") WHERE meta_message_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_whatsapp_templates_tenant_name_lang" ON "floraclin"."whatsapp_templates" USING btree ("tenant_id","name","language");
