CREATE TABLE "floraclin"."clinical_document_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"name" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "floraclin"."clinical_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"template_id" uuid,
	"professional_snapshot" jsonb NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_via" varchar(20) NOT NULL,
	"whatsapp_message_id" text,
	"storage_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floraclin"."package_template_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"procedure_type_id" uuid NOT NULL,
	"sessions_count" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floraclin"."package_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"default_price" numeric(10, 2),
	"validity_months" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "floraclin"."patient_greetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"occasion_year" integer NOT NULL,
	"greeted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"greeted_by" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floraclin"."patient_package_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_package_id" uuid NOT NULL,
	"procedure_type_id" uuid NOT NULL,
	"procedure_type_name" varchar(255) NOT NULL,
	"sessions_total" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floraclin"."patient_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"template_id" uuid,
	"name" varchar(255) NOT NULL,
	"total_amount" numeric(10, 2) NOT NULL,
	"purchased_at" date NOT NULL,
	"expires_at" date,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"financial_entry_id" uuid NOT NULL,
	"sold_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floraclin"."procedure_followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"procedure_record_id" uuid NOT NULL,
	"contacted_by" uuid NOT NULL,
	"contacted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" varchar(20) NOT NULL,
	"outcome" varchar(30) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "floraclin"."photo_assets" ADD COLUMN "crop_box" jsonb;--> statement-breakpoint
ALTER TABLE "floraclin"."photo_assets" ADD COLUMN "crop_aspect" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_records" ADD COLUMN "patient_package_id" uuid;--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_records" ADD COLUMN "patient_package_line_id" uuid;--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_records" ADD COLUMN "followup_snoozed_until" date;--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_records" ADD COLUMN "last_contacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "floraclin"."users" ADD COLUMN "signature_data" text;--> statement-breakpoint
ALTER TABLE "floraclin"."users" ADD COLUMN "signature_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "floraclin"."users" ADD COLUMN "professional_title" varchar(100);--> statement-breakpoint
ALTER TABLE "floraclin"."users" ADD COLUMN "registry_type" varchar(10);--> statement-breakpoint
ALTER TABLE "floraclin"."users" ADD COLUMN "registry_number" varchar(20);--> statement-breakpoint
ALTER TABLE "floraclin"."users" ADD COLUMN "registry_state" varchar(2);--> statement-breakpoint
ALTER TABLE "floraclin"."clinical_document_templates" ADD CONSTRAINT "clinical_document_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."clinical_document_templates" ADD CONSTRAINT "clinical_document_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."clinical_documents" ADD CONSTRAINT "clinical_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."clinical_documents" ADD CONSTRAINT "clinical_documents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "floraclin"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."clinical_documents" ADD CONSTRAINT "clinical_documents_practitioner_id_users_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."clinical_documents" ADD CONSTRAINT "clinical_documents_template_id_clinical_document_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "floraclin"."clinical_document_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."package_template_lines" ADD CONSTRAINT "package_template_lines_template_id_package_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "floraclin"."package_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."package_template_lines" ADD CONSTRAINT "package_template_lines_procedure_type_id_procedure_types_id_fk" FOREIGN KEY ("procedure_type_id") REFERENCES "floraclin"."procedure_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."package_templates" ADD CONSTRAINT "package_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."patient_greetings" ADD CONSTRAINT "patient_greetings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."patient_greetings" ADD CONSTRAINT "patient_greetings_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "floraclin"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."patient_greetings" ADD CONSTRAINT "patient_greetings_greeted_by_users_id_fk" FOREIGN KEY ("greeted_by") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."patient_package_lines" ADD CONSTRAINT "patient_package_lines_patient_package_id_patient_packages_id_fk" FOREIGN KEY ("patient_package_id") REFERENCES "floraclin"."patient_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."patient_package_lines" ADD CONSTRAINT "patient_package_lines_procedure_type_id_procedure_types_id_fk" FOREIGN KEY ("procedure_type_id") REFERENCES "floraclin"."procedure_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."patient_packages" ADD CONSTRAINT "patient_packages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."patient_packages" ADD CONSTRAINT "patient_packages_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "floraclin"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."patient_packages" ADD CONSTRAINT "patient_packages_template_id_package_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "floraclin"."package_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."patient_packages" ADD CONSTRAINT "patient_packages_financial_entry_id_financial_entries_id_fk" FOREIGN KEY ("financial_entry_id") REFERENCES "floraclin"."financial_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."patient_packages" ADD CONSTRAINT "patient_packages_sold_by_users_id_fk" FOREIGN KEY ("sold_by") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_followups" ADD CONSTRAINT "procedure_followups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_followups" ADD CONSTRAINT "procedure_followups_procedure_record_id_procedure_records_id_fk" FOREIGN KEY ("procedure_record_id") REFERENCES "floraclin"."procedure_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_followups" ADD CONSTRAINT "procedure_followups_contacted_by_users_id_fk" FOREIGN KEY ("contacted_by") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_clinical_document_templates_tenant_kind" ON "floraclin"."clinical_document_templates" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "idx_clinical_documents_tenant_patient_issued" ON "floraclin"."clinical_documents" USING btree ("tenant_id","patient_id","issued_at");--> statement-breakpoint
CREATE INDEX "idx_package_template_lines_template" ON "floraclin"."package_template_lines" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "idx_package_templates_tenant" ON "floraclin"."package_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_patient_greetings_patient_year" ON "floraclin"."patient_greetings" USING btree ("patient_id","occasion_year");--> statement-breakpoint
CREATE INDEX "idx_patient_greetings_tenant_year" ON "floraclin"."patient_greetings" USING btree ("tenant_id","occasion_year");--> statement-breakpoint
CREATE INDEX "idx_patient_package_lines_package" ON "floraclin"."patient_package_lines" USING btree ("patient_package_id");--> statement-breakpoint
CREATE INDEX "idx_patient_packages_tenant_patient" ON "floraclin"."patient_packages" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "idx_patient_packages_status" ON "floraclin"."patient_packages" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_procedure_followups_record_contacted" ON "floraclin"."procedure_followups" USING btree ("procedure_record_id","contacted_at");--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_records" ADD CONSTRAINT "procedure_records_patient_package_id_patient_packages_id_fk" FOREIGN KEY ("patient_package_id") REFERENCES "floraclin"."patient_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_records" ADD CONSTRAINT "procedure_records_patient_package_line_id_patient_package_lines_id_fk" FOREIGN KEY ("patient_package_line_id") REFERENCES "floraclin"."patient_package_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_procedure_records_package_line" ON "floraclin"."procedure_records" USING btree ("patient_package_line_id");--> statement-breakpoint
CREATE INDEX "idx_procedure_records_followup_status" ON "floraclin"."procedure_records" USING btree ("tenant_id","status","followup_snoozed_until");--> statement-breakpoint

-- CHECK constraints
ALTER TABLE "floraclin"."patient_packages"
  ADD CONSTRAINT "patient_packages_status_check"
  CHECK ("status" IN ('active', 'completed', 'cancelled', 'expired'));--> statement-breakpoint

ALTER TABLE "floraclin"."clinical_document_templates"
  ADD CONSTRAINT "clinical_document_templates_kind_check"
  CHECK ("kind" IN ('receita', 'atestado'));--> statement-breakpoint

ALTER TABLE "floraclin"."clinical_documents"
  ADD CONSTRAINT "clinical_documents_kind_check"
  CHECK ("kind" IN ('receita', 'atestado'));--> statement-breakpoint

ALTER TABLE "floraclin"."clinical_documents"
  ADD CONSTRAINT "clinical_documents_delivered_via_check"
  CHECK ("delivered_via" IN ('whatsapp', 'print', 'download', 'multiple'));--> statement-breakpoint

ALTER TABLE "floraclin"."procedure_followups"
  ADD CONSTRAINT "procedure_followups_channel_check"
  CHECK ("channel" IN ('whatsapp', 'call', 'in_person', 'other'));--> statement-breakpoint

ALTER TABLE "floraclin"."procedure_followups"
  ADD CONSTRAINT "procedure_followups_outcome_check"
  CHECK ("outcome" IN ('agendou', 'pediu_para_aguardar', 'sem_resposta', 'desistiu', 'outro'));--> statement-breakpoint

ALTER TABLE "floraclin"."package_template_lines"
  ADD CONSTRAINT "package_template_lines_sessions_positive"
  CHECK ("sessions_count" > 0);--> statement-breakpoint

ALTER TABLE "floraclin"."patient_package_lines"
  ADD CONSTRAINT "patient_package_lines_sessions_positive"
  CHECK ("sessions_total" > 0);--> statement-breakpoint

ALTER TABLE "floraclin"."users"
  ADD CONSTRAINT "users_registry_type_check"
  CHECK ("registry_type" IS NULL OR "registry_type" IN ('CRM', 'CRO', 'CRBM', 'CRF', 'CREFITO', 'COREN', 'OTHER'));--> statement-breakpoint

-- Expression index for fast birthday lookups
CREATE INDEX IF NOT EXISTS "idx_patients_birth_md"
  ON "floraclin"."patients" (
    "tenant_id",
    EXTRACT(MONTH FROM "birth_date"),
    EXTRACT(DAY FROM "birth_date")
  )
  WHERE "deleted_at" IS NULL AND "birth_date" IS NOT NULL;
