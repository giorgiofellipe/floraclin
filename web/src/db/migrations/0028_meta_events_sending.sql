ALTER TABLE "floraclin"."meta_conversion_events" ADD COLUMN IF NOT EXISTS "claimed_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_meta_events_claimed" ON "floraclin"."meta_conversion_events" ("status","claimed_at");
--> statement-breakpoint
UPDATE "floraclin"."meta_conversion_events"
SET "status" = 'pending', "skip_reason" = NULL
WHERE "status" = 'skipped'
	AND "skip_reason" = 'no_connection'
	AND "created_at" > now() - interval '7 days';
