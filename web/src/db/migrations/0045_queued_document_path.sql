ALTER TABLE "floraclin"."whatsapp_queued_messages" ADD COLUMN IF NOT EXISTS "media_path" text;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_queued_messages" ADD COLUMN IF NOT EXISTS "media_filename" varchar(255);--> statement-breakpoint
UPDATE "floraclin"."whatsapp_queued_messages" SET "status" = 'expired', "expired_at" = now() WHERE "status" = 'queued' AND "media_url" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_queued_messages" DROP COLUMN IF EXISTS "media_url";
