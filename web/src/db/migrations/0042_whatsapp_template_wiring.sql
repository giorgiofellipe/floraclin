ALTER TABLE "floraclin"."procedure_types" ADD COLUMN IF NOT EXISTS "pre_procedure_instructions" text;--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_types" ADD COLUMN IF NOT EXISTS "post_procedure_care" text;--> statement-breakpoint
ALTER TABLE "floraclin"."appointments" ADD COLUMN IF NOT EXISTS "pre_instructions_sent_at" timestamptz;--> statement-breakpoint
ALTER TABLE "floraclin"."patients" ADD COLUMN IF NOT EXISTS "reactivation_sent_at" timestamptz;
