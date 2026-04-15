CREATE SCHEMA "floraclin";
--> statement-breakpoint
CREATE TABLE "floraclin"."anamneses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"main_complaint" text,
	"patient_goals" text,
	"medical_history" jsonb DEFAULT '{}'::jsonb,
	"medications" jsonb DEFAULT '[]'::jsonb,
	"allergies" jsonb DEFAULT '[]'::jsonb,
	"previous_surgeries" jsonb DEFAULT '[]'::jsonb,
	"chronic_conditions" jsonb DEFAULT '[]'::jsonb,
	"is_pregnant" boolean DEFAULT false,
	"is_breastfeeding" boolean DEFAULT false,
	"lifestyle" jsonb DEFAULT '{}'::jsonb,
	"skin_type" varchar(20),
	"skin_conditions" jsonb DEFAULT '[]'::jsonb,
	"skincare_routine" jsonb DEFAULT '[]'::jsonb,
	"previous_aesthetic_treatments" jsonb DEFAULT '[]'::jsonb,
	"contraindications" jsonb DEFAULT '[]'::jsonb,
	"facial_evaluation_notes" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anamneses_patient_id_unique" UNIQUE("patient_id")
);
--> statement-breakpoint
CREATE TABLE "floraclin"."appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid,
	"practitioner_id" uuid NOT NULL,
	"procedure_type_id" uuid,
	"date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"status" varchar(20) DEFAULT 'scheduled' NOT NULL,
	"source" varchar(20) DEFAULT 'internal' NOT NULL,
	"booking_name" varchar(255),
	"booking_phone" varchar(20),
	"booking_email" varchar(255),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "floraclin"."audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid NOT NULL,
	"action" varchar(50) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid,
	"changes" jsonb,
	"ip_address" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floraclin"."consent_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"consent_template_id" uuid NOT NULL,
	"procedure_record_id" uuid,
	"acceptance_method" varchar(20) NOT NULL,
	"signature_data" text,
	"content_hash" varchar(64) NOT NULL,
	"content_snapshot" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floraclin"."consent_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" varchar(30) NOT NULL,
	"title" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floraclin"."diagram_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"face_diagram_id" uuid NOT NULL,
	"x" numeric(5, 2) NOT NULL,
	"y" numeric(5, 2) NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"active_ingredient" varchar(255),
	"quantity" numeric(8, 2) NOT NULL,
	"quantity_unit" varchar(10) DEFAULT 'U' NOT NULL,
	"technique" varchar(100),
	"depth" varchar(50),
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floraclin"."face_diagrams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"procedure_record_id" uuid NOT NULL,
	"view_type" varchar(20) DEFAULT 'front' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floraclin"."financial_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"procedure_record_id" uuid,
	"appointment_id" uuid,
	"description" varchar(255) NOT NULL,
	"total_amount" numeric(10, 2) NOT NULL,
	"installment_count" integer DEFAULT 1 NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "floraclin"."installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"financial_entry_id" uuid NOT NULL,
	"installment_number" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"due_date" date NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"payment_method" varchar(20),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floraclin"."patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"responsible_user_id" uuid,
	"full_name" varchar(255) NOT NULL,
	"cpf" varchar(14),
	"birth_date" date,
	"gender" varchar(20),
	"email" varchar(255),
	"phone" varchar(20) NOT NULL,
	"phone_secondary" varchar(20),
	"address" jsonb,
	"occupation" varchar(100),
	"referral_source" varchar(100),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "floraclin"."photo_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"photo_asset_id" uuid NOT NULL,
	"annotation_data" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floraclin"."photo_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"procedure_record_id" uuid,
	"storage_path" text NOT NULL,
	"original_filename" varchar(255),
	"mime_type" varchar(50),
	"file_size_bytes" integer,
	"timeline_stage" varchar(20),
	"taken_at" timestamp with time zone,
	"uploaded_by" uuid NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "floraclin"."procedure_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"procedure_type_id" uuid NOT NULL,
	"appointment_id" uuid,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"technique" text,
	"clinical_response" text,
	"adverse_effects" text,
	"notes" text,
	"follow_up_date" date,
	"next_session_objectives" text,
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "floraclin"."procedure_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"category" varchar(50) NOT NULL,
	"description" text,
	"default_price" numeric(10, 2),
	"estimated_duration_min" integer DEFAULT 60,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "floraclin"."product_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"procedure_record_id" uuid NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"active_ingredient" varchar(255),
	"total_quantity" numeric(8, 2) NOT NULL,
	"quantity_unit" varchar(10) DEFAULT 'U' NOT NULL,
	"batch_number" varchar(100),
	"expiration_date" date,
	"label_photo_id" uuid,
	"application_areas" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floraclin"."tenant_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floraclin"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"logo_url" text,
	"phone" varchar(20),
	"email" varchar(255),
	"address" jsonb,
	"working_hours" jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "floraclin"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"phone" varchar(20),
	"avatar_url" text,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "floraclin"."anamneses" ADD CONSTRAINT "anamneses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."anamneses" ADD CONSTRAINT "anamneses_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "floraclin"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."anamneses" ADD CONSTRAINT "anamneses_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."appointments" ADD CONSTRAINT "appointments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "floraclin"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."appointments" ADD CONSTRAINT "appointments_practitioner_id_users_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."appointments" ADD CONSTRAINT "appointments_procedure_type_id_procedure_types_id_fk" FOREIGN KEY ("procedure_type_id") REFERENCES "floraclin"."procedure_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."consent_acceptances" ADD CONSTRAINT "consent_acceptances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."consent_acceptances" ADD CONSTRAINT "consent_acceptances_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "floraclin"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."consent_acceptances" ADD CONSTRAINT "consent_acceptances_consent_template_id_consent_templates_id_fk" FOREIGN KEY ("consent_template_id") REFERENCES "floraclin"."consent_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."consent_acceptances" ADD CONSTRAINT "consent_acceptances_procedure_record_id_procedure_records_id_fk" FOREIGN KEY ("procedure_record_id") REFERENCES "floraclin"."procedure_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."consent_templates" ADD CONSTRAINT "consent_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."diagram_points" ADD CONSTRAINT "diagram_points_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."diagram_points" ADD CONSTRAINT "diagram_points_face_diagram_id_face_diagrams_id_fk" FOREIGN KEY ("face_diagram_id") REFERENCES "floraclin"."face_diagrams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."face_diagrams" ADD CONSTRAINT "face_diagrams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."face_diagrams" ADD CONSTRAINT "face_diagrams_procedure_record_id_procedure_records_id_fk" FOREIGN KEY ("procedure_record_id") REFERENCES "floraclin"."procedure_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."financial_entries" ADD CONSTRAINT "financial_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."financial_entries" ADD CONSTRAINT "financial_entries_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "floraclin"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."financial_entries" ADD CONSTRAINT "financial_entries_procedure_record_id_procedure_records_id_fk" FOREIGN KEY ("procedure_record_id") REFERENCES "floraclin"."procedure_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."financial_entries" ADD CONSTRAINT "financial_entries_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "floraclin"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."financial_entries" ADD CONSTRAINT "financial_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."installments" ADD CONSTRAINT "installments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."installments" ADD CONSTRAINT "installments_financial_entry_id_financial_entries_id_fk" FOREIGN KEY ("financial_entry_id") REFERENCES "floraclin"."financial_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."patients" ADD CONSTRAINT "patients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."patients" ADD CONSTRAINT "patients_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."photo_annotations" ADD CONSTRAINT "photo_annotations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."photo_annotations" ADD CONSTRAINT "photo_annotations_photo_asset_id_photo_assets_id_fk" FOREIGN KEY ("photo_asset_id") REFERENCES "floraclin"."photo_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."photo_annotations" ADD CONSTRAINT "photo_annotations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."photo_assets" ADD CONSTRAINT "photo_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."photo_assets" ADD CONSTRAINT "photo_assets_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "floraclin"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."photo_assets" ADD CONSTRAINT "photo_assets_procedure_record_id_procedure_records_id_fk" FOREIGN KEY ("procedure_record_id") REFERENCES "floraclin"."procedure_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."photo_assets" ADD CONSTRAINT "photo_assets_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_records" ADD CONSTRAINT "procedure_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_records" ADD CONSTRAINT "procedure_records_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "floraclin"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_records" ADD CONSTRAINT "procedure_records_practitioner_id_users_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_records" ADD CONSTRAINT "procedure_records_procedure_type_id_procedure_types_id_fk" FOREIGN KEY ("procedure_type_id") REFERENCES "floraclin"."procedure_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_records" ADD CONSTRAINT "procedure_records_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "floraclin"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_types" ADD CONSTRAINT "procedure_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."product_applications" ADD CONSTRAINT "product_applications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."product_applications" ADD CONSTRAINT "product_applications_procedure_record_id_procedure_records_id_fk" FOREIGN KEY ("procedure_record_id") REFERENCES "floraclin"."procedure_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."product_applications" ADD CONSTRAINT "product_applications_label_photo_id_photo_assets_id_fk" FOREIGN KEY ("label_photo_id") REFERENCES "floraclin"."photo_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."tenant_users" ADD CONSTRAINT "tenant_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."tenant_users" ADD CONSTRAINT "tenant_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_anamneses_patient" ON "floraclin"."anamneses" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "idx_appointments_date" ON "floraclin"."appointments" USING btree ("tenant_id","practitioner_id","date");--> statement-breakpoint
CREATE INDEX "idx_appointments_patient" ON "floraclin"."appointments" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_tenant" ON "floraclin"."audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_entity" ON "floraclin"."audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_consent_acceptances_patient" ON "floraclin"."consent_acceptances" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_consent_template_version" ON "floraclin"."consent_templates" USING btree ("tenant_id","type","version");--> statement-breakpoint
CREATE INDEX "idx_diagram_points_diagram" ON "floraclin"."diagram_points" USING btree ("face_diagram_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_face_diagrams_record_view" ON "floraclin"."face_diagrams" USING btree ("procedure_record_id","view_type");--> statement-breakpoint
CREATE INDEX "idx_financial_entries_patient" ON "floraclin"."financial_entries" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "idx_financial_entries_status" ON "floraclin"."financial_entries" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_installments_entry" ON "floraclin"."installments" USING btree ("financial_entry_id");--> statement-breakpoint
CREATE INDEX "idx_installments_due" ON "floraclin"."installments" USING btree ("tenant_id","due_date","status");--> statement-breakpoint
CREATE INDEX "idx_patients_tenant" ON "floraclin"."patients" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_patients_name" ON "floraclin"."patients" USING btree ("tenant_id","full_name");--> statement-breakpoint
CREATE INDEX "idx_patients_phone" ON "floraclin"."patients" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE INDEX "idx_patients_cpf" ON "floraclin"."patients" USING btree ("tenant_id","cpf");--> statement-breakpoint
CREATE INDEX "idx_photo_assets_patient" ON "floraclin"."photo_assets" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "idx_procedure_records_patient" ON "floraclin"."procedure_records" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "idx_procedure_records_practitioner" ON "floraclin"."procedure_records" USING btree ("tenant_id","practitioner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tenant_users_tenant_user" ON "floraclin"."tenant_users" USING btree ("tenant_id","user_id");