ALTER TABLE "floraclin"."procedure_sessions" ADD COLUMN IF NOT EXISTS "follow_up_sent_at" timestamptz;--> statement-breakpoint
ALTER TABLE "floraclin"."installments" ADD COLUMN IF NOT EXISTS "reminder_sent_at" timestamptz;--> statement-breakpoint
-- The settings form had no upper bound before; the crons now reject values outside these ranges.
UPDATE "floraclin"."whatsapp_automations"
SET "config" = jsonb_set("config", '{daysBeforeDue}', to_jsonb(LEAST(GREATEST(round(("config"->>'daysBeforeDue')::numeric), 1), 30)::int))
WHERE "trigger" = 'payment_reminder' AND jsonb_typeof("config"->'daysBeforeDue') = 'number'
  AND (("config"->>'daysBeforeDue')::numeric NOT BETWEEN 1 AND 30 OR ("config"->>'daysBeforeDue')::numeric <> round(("config"->>'daysBeforeDue')::numeric));--> statement-breakpoint
UPDATE "floraclin"."whatsapp_automations"
SET "config" = jsonb_set("config", '{daysAfterProcedure}', to_jsonb(LEAST(GREATEST(round(("config"->>'daysAfterProcedure')::numeric), 1), 30)::int))
WHERE "trigger" = 'follow_up' AND jsonb_typeof("config"->'daysAfterProcedure') = 'number'
  AND (("config"->>'daysAfterProcedure')::numeric NOT BETWEEN 1 AND 30 OR ("config"->>'daysAfterProcedure')::numeric <> round(("config"->>'daysAfterProcedure')::numeric));--> statement-breakpoint
UPDATE "floraclin"."whatsapp_automations"
SET "config" = jsonb_set("config", '{anamnesisStaleDays}', to_jsonb(LEAST(GREATEST(round(("config"->>'anamnesisStaleDays')::numeric), 1), 365)::int))
WHERE "trigger" = 'appointment_confirmation' AND jsonb_typeof("config"->'anamnesisStaleDays') = 'number'
  AND (("config"->>'anamnesisStaleDays')::numeric NOT BETWEEN 1 AND 365 OR ("config"->>'anamnesisStaleDays')::numeric <> round(("config"->>'anamnesisStaleDays')::numeric));
