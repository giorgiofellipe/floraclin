ALTER TABLE "floraclin"."appointments" ADD COLUMN "confirmation_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "floraclin"."appointments" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "floraclin"."appointments" ADD COLUMN "confirmation_message_id" varchar(100);--> statement-breakpoint
UPDATE "floraclin"."whatsapp_automations" SET "trigger" = 'appointment_confirmation' WHERE "trigger" = 'appointment_reminder';
