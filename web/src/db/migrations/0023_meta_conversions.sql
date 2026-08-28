CREATE TABLE IF NOT EXISTS "floraclin"."lead_attributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"channel" varchar(20) NOT NULL,
	"ctwa_clid" text,
	"fbclid" text,
	"fbp" text,
	"fbc" text,
	"ad_id" varchar(64),
	"adset_id" varchar(64),
	"campaign_id" varchar(64),
	"ad_headline" text,
	"source_url" text,
	"landing_url" text,
	"client_ip" varchar(64),
	"user_agent" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floraclin"."meta_conversion_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"prospect_id" uuid,
	"event_name" varchar(30) NOT NULL,
	"event_id" varchar(120) NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"value" numeric(10, 2),
	"currency" varchar(3) DEFAULT 'BRL' NOT NULL,
	"payload" jsonb,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"skip_reason" varchar(40),
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"fb_trace_id" varchar(64),
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floraclin"."meta_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"dataset_id" varchar(64) NOT NULL,
	"access_token" text NOT NULL,
	"business_id" varchar(64),
	"connection_type" varchar(10) DEFAULT 'manual' NOT NULL,
	"token_expires_at" timestamp with time zone,
	"test_event_code" varchar(32),
	"advanced_matching_enabled" boolean DEFAULT true NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledgement_version" varchar(20),
	"acknowledged_by" uuid,
	"last_verified_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "floraclin"."lead_attributions" ADD CONSTRAINT "lead_attributions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "floraclin"."lead_attributions" ADD CONSTRAINT "lead_attributions_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "floraclin"."prospects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "floraclin"."meta_conversion_events" ADD CONSTRAINT "meta_conversion_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "floraclin"."meta_conversion_events" ADD CONSTRAINT "meta_conversion_events_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "floraclin"."prospects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "floraclin"."meta_connections" ADD CONSTRAINT "meta_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "floraclin"."meta_connections" ADD CONSTRAINT "meta_connections_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "floraclin"."patients" ADD COLUMN IF NOT EXISTS "marketing_opt_out" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "floraclin"."prospects" ADD COLUMN IF NOT EXISTS "marketing_opt_out" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_lead_attributions_prospect" ON "floraclin"."lead_attributions" ("prospect_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_attributions_tenant_ad" ON "floraclin"."lead_attributions" ("tenant_id","ad_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_attributions_tenant_captured" ON "floraclin"."lead_attributions" ("tenant_id","captured_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_meta_events_tenant_event" ON "floraclin"."meta_conversion_events" ("tenant_id","event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_meta_events_pending" ON "floraclin"."meta_conversion_events" ("status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_meta_events_tenant_created" ON "floraclin"."meta_conversion_events" ("tenant_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_meta_connections_tenant" ON "floraclin"."meta_connections" ("tenant_id");
