ALTER TABLE "floraclin"."calendar_blocks" ALTER COLUMN "practitioner_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "floraclin"."calendar_blocks" ALTER COLUMN "connection_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "floraclin"."calendar_blocks" ALTER COLUMN "google_event_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "floraclin"."calendar_blocks" ADD COLUMN "source" varchar(10) NOT NULL DEFAULT 'google';
--> statement-breakpoint
ALTER TABLE "floraclin"."calendar_blocks" ADD CONSTRAINT "calendar_blocks_source_check" CHECK ("source" IN ('google', 'manual'));
--> statement-breakpoint
ALTER TABLE "floraclin"."calendar_blocks" ADD CONSTRAINT "calendar_blocks_source_shape_check" CHECK (("source" = 'google' AND "connection_id" IS NOT NULL AND "google_event_id" IS NOT NULL) OR ("source" = 'manual' AND "connection_id" IS NULL AND "google_event_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "floraclin"."calendar_blocks" ADD CONSTRAINT "calendar_blocks_timing_shape_check" CHECK (("all_day" = true AND "start_time" IS NULL AND "end_time" IS NULL) OR ("all_day" = false AND "start_time" IS NOT NULL AND "end_time" IS NOT NULL));
--> statement-breakpoint
CREATE INDEX "idx_calendar_blocks_tenant_date" ON "floraclin"."calendar_blocks" ("tenant_id", "date");
