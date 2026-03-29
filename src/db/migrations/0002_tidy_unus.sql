ALTER TABLE "floraclin"."procedure_records" ALTER COLUMN "status" SET DEFAULT 'planned';--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_records" ADD COLUMN "planned_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_records" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_records" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_records" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_records" ADD COLUMN "financial_plan" jsonb;--> statement-breakpoint
ALTER TABLE "floraclin"."products" ADD COLUMN "show_in_diagram" boolean DEFAULT true NOT NULL;