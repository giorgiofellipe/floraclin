ALTER TABLE "floraclin"."procedure_sessions" ADD COLUMN IF NOT EXISTS "follow_up_sent_at" timestamptz;--> statement-breakpoint
ALTER TABLE "floraclin"."installments" ADD COLUMN IF NOT EXISTS "reminder_sent_at" timestamptz;
