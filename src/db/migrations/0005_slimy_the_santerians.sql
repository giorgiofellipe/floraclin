CREATE TABLE "floraclin"."cash_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"description" varchar(255) NOT NULL,
	"payment_method" varchar(20),
	"movement_date" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payment_record_id" uuid,
	"expense_installment_id" uuid,
	"patient_id" uuid,
	"expense_category_id" uuid,
	"recorded_by" uuid NOT NULL,
	"reversed_by_movement_id" uuid
);
--> statement-breakpoint
CREATE TABLE "floraclin"."expense_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floraclin"."expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"name" varchar(100) NOT NULL,
	"icon" varchar(50) DEFAULT 'circle' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "floraclin"."expense_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"installment_number" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"due_date" date NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"payment_method" varchar(20),
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "floraclin"."expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
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
CREATE TABLE "floraclin"."financial_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fine_type" varchar(20) DEFAULT 'percentage' NOT NULL,
	"fine_value" numeric(5, 2) DEFAULT '2.00' NOT NULL,
	"monthly_interest_percent" numeric(5, 2) DEFAULT '1.00' NOT NULL,
	"grace_period_days" integer DEFAULT 0 NOT NULL,
	"bank_name" varchar(100),
	"bank_agency" varchar(20),
	"bank_account" varchar(30),
	"pix_key_type" varchar(20),
	"pix_key" varchar(100),
	"default_installment_count" integer DEFAULT 1 NOT NULL,
	"default_payment_method" varchar(20),
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_settings_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "floraclin"."payment_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installment_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"payment_method" varchar(20) NOT NULL,
	"interest_covered" numeric(10, 2) DEFAULT '0' NOT NULL,
	"fine_covered" numeric(10, 2) DEFAULT '0' NOT NULL,
	"principal_covered" numeric(10, 2) DEFAULT '0' NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "floraclin"."renegotiation_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_entry_id" uuid NOT NULL,
	"new_entry_id" uuid NOT NULL,
	"original_remaining_principal" numeric(10, 2) NOT NULL,
	"penalties_included" numeric(10, 2) DEFAULT '0' NOT NULL,
	"penalties_waived" numeric(10, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "floraclin"."financial_entries" ADD COLUMN "renegotiated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "floraclin"."installments" ADD COLUMN "fine_amount" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "floraclin"."installments" ADD COLUMN "interest_amount" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "floraclin"."installments" ADD COLUMN "amount_paid" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "floraclin"."installments" ADD COLUMN "last_fine_interest_calc_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "floraclin"."installments" ADD COLUMN "applied_fine_type" varchar(20);--> statement-breakpoint
ALTER TABLE "floraclin"."installments" ADD COLUMN "applied_fine_value" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "floraclin"."installments" ADD COLUMN "applied_interest_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "floraclin"."cash_movements" ADD CONSTRAINT "cash_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."cash_movements" ADD CONSTRAINT "cash_movements_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "floraclin"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."cash_movements" ADD CONSTRAINT "cash_movements_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."expense_attachments" ADD CONSTRAINT "expense_attachments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "floraclin"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."expense_attachments" ADD CONSTRAINT "expense_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."expense_installments" ADD CONSTRAINT "expense_installments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "floraclin"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."expenses" ADD CONSTRAINT "expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."financial_settings" ADD CONSTRAINT "financial_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."financial_settings" ADD CONSTRAINT "financial_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."payment_records" ADD CONSTRAINT "payment_records_installment_id_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "floraclin"."installments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."payment_records" ADD CONSTRAINT "payment_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."renegotiation_links" ADD CONSTRAINT "renegotiation_links_original_entry_id_financial_entries_id_fk" FOREIGN KEY ("original_entry_id") REFERENCES "floraclin"."financial_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."renegotiation_links" ADD CONSTRAINT "renegotiation_links_new_entry_id_financial_entries_id_fk" FOREIGN KEY ("new_entry_id") REFERENCES "floraclin"."financial_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cash_movements_tenant_date" ON "floraclin"."cash_movements" USING btree ("tenant_id","movement_date");--> statement-breakpoint
CREATE INDEX "idx_cash_movements_type" ON "floraclin"."cash_movements" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE INDEX "idx_expense_attachments_expense" ON "floraclin"."expense_attachments" USING btree ("expense_id");--> statement-breakpoint
CREATE INDEX "idx_expense_categories_tenant" ON "floraclin"."expense_categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_expense_installments_expense" ON "floraclin"."expense_installments" USING btree ("expense_id");--> statement-breakpoint
CREATE INDEX "idx_expenses_tenant" ON "floraclin"."expenses" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_expenses_category" ON "floraclin"."expenses" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE INDEX "idx_payment_records_installment" ON "floraclin"."payment_records" USING btree ("installment_id");--> statement-breakpoint
CREATE INDEX "idx_renegotiation_links_original" ON "floraclin"."renegotiation_links" USING btree ("original_entry_id");--> statement-breakpoint
CREATE INDEX "idx_renegotiation_links_new" ON "floraclin"."renegotiation_links" USING btree ("new_entry_id");