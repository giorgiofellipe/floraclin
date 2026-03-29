CREATE TABLE "floraclin"."evaluation_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"procedure_record_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"template_version" integer NOT NULL,
	"template_snapshot" jsonb NOT NULL,
	"responses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floraclin"."evaluation_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"procedure_type_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "floraclin"."evaluation_responses" ADD CONSTRAINT "evaluation_responses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."evaluation_responses" ADD CONSTRAINT "evaluation_responses_procedure_record_id_procedure_records_id_fk" FOREIGN KEY ("procedure_record_id") REFERENCES "floraclin"."procedure_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."evaluation_responses" ADD CONSTRAINT "evaluation_responses_template_id_evaluation_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "floraclin"."evaluation_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."evaluation_templates" ADD CONSTRAINT "evaluation_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."evaluation_templates" ADD CONSTRAINT "evaluation_templates_procedure_type_id_procedure_types_id_fk" FOREIGN KEY ("procedure_type_id") REFERENCES "floraclin"."procedure_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_evaluation_responses_procedure" ON "floraclin"."evaluation_responses" USING btree ("tenant_id","procedure_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_evaluation_templates_tenant_procedure" ON "floraclin"."evaluation_templates" USING btree ("tenant_id","procedure_type_id");--> statement-breakpoint
CREATE INDEX "idx_evaluation_templates_tenant" ON "floraclin"."evaluation_templates" USING btree ("tenant_id");