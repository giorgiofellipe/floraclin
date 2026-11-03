-- NFS-e Nacional emission after payment. Additive only: safe to apply before the deploy that uses it.
-- nfse_settings holds the clinic's encrypted A1 certificate and fiscal settings; nfse_dps_sequences numbers
-- DPS per (CNPJ, city, series); nfse_documents is the emission outbox, one active note per payment record.
CREATE TABLE IF NOT EXISTS "floraclin"."nfse_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"certificate_pfx" text NOT NULL,
	"certificate_password" text NOT NULL,
	"cnpj" varchar(14) NOT NULL,
	"certificate_subject" text NOT NULL,
	"certificate_issuer" text NOT NULL,
	"certificate_valid_from" timestamp with time zone NOT NULL,
	"certificate_valid_to" timestamp with time zone NOT NULL,
	"municipal_registration" varchar(30),
	"municipality_code" varchar(7),
	"simples_nacional_option" smallint,
	"simples_nacional_regime" smallint,
	"simples_nacional_tax_rate" numeric(5,2),
	"service_preset" varchar(30),
	"advanced_codes" jsonb,
	"iss_rate" numeric(5,2),
	"iss_withheld" boolean DEFAULT false NOT NULL,
	"emission_mode" varchar(10) DEFAULT 'ask' NOT NULL,
	"always_enabled_at" timestamp with time zone,
	"email_patient" boolean DEFAULT false NOT NULL,
	"configured_at" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nfse_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id"),
	CONSTRAINT "nfse_settings_simples_option_check" CHECK ("simples_nacional_option" BETWEEN 1 AND 3),
	CONSTRAINT "nfse_settings_simples_regime_check" CHECK ("simples_nacional_regime" BETWEEN 1 AND 3),
	CONSTRAINT "nfse_settings_simples_rate_check" CHECK ("simples_nacional_tax_rate" BETWEEN 0 AND 100),
	CONSTRAINT "nfse_settings_iss_rate_check" CHECK ("iss_rate" BETWEEN 0 AND 100),
	CONSTRAINT "nfse_settings_emission_mode_check" CHECK ("emission_mode" IN ('ask', 'always'))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floraclin"."nfse_dps_sequences" (
	"cnpj" varchar(14) NOT NULL,
	"municipality_code" varchar(7) NOT NULL,
	"series" varchar(5) NOT NULL,
	"last_number" bigint NOT NULL,
	CONSTRAINT "nfse_dps_sequences_pkey" PRIMARY KEY ("cnpj", "municipality_code", "series")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floraclin"."nfse_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_record_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"environment" varchar(12) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"value" numeric(10,2) NOT NULL,
	"competence_date" date NOT NULL,
	"email_requested" boolean DEFAULT false NOT NULL,
	"payload_snapshot" jsonb,
	"dps_number" bigint,
	"dps_id" varchar(45),
	"access_key" varchar(50),
	"nfse_number" varchar(20),
	"nfse_xml" text,
	"error_code" varchar(40),
	"error_message" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"issued_at" timestamp with time zone,
	"email_sent_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"cancel_reason" smallint,
	"cancel_justification" text,
	"cancel_attempt_count" integer DEFAULT 0 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nfse_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id"),
	CONSTRAINT "nfse_documents_payment_record_id_payment_records_id_fk" FOREIGN KEY ("payment_record_id") REFERENCES "floraclin"."payment_records"("id"),
	CONSTRAINT "nfse_documents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "floraclin"."patients"("id"),
	CONSTRAINT "nfse_documents_status_check" CHECK ("status" IN ('pending', 'processing', 'issued', 'failed', 'cancelled')),
	CONSTRAINT "nfse_documents_environment_check" CHECK ("environment" IN ('production', 'restricted'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_nfse_documents_active_payment" ON "floraclin"."nfse_documents" USING btree ("payment_record_id") WHERE "status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_nfse_documents_tenant_status" ON "floraclin"."nfse_documents" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_nfse_documents_status_cancel" ON "floraclin"."nfse_documents" USING btree ("status","cancel_requested_at");--> statement-breakpoint
ALTER TABLE "floraclin"."nfse_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "floraclin"."nfse_dps_sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "floraclin"."nfse_documents" ENABLE ROW LEVEL SECURITY;
