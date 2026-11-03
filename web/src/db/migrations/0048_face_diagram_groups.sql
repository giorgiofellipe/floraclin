-- Standalone face diagrams, part 1 of 2. Apply BEFORE deploying the code that reads
-- face_diagram_groups. Additive only: old instances keep working because
-- face_diagrams keeps its legacy columns (procedure_record_id is made nullable).
-- Idempotent; re-running after 0049 is a no-op.
CREATE TABLE IF NOT EXISTS "floraclin"."face_diagram_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
	"patient_id" uuid NOT NULL REFERENCES "floraclin"."patients"("id"),
	"practitioner_id" uuid NOT NULL REFERENCES "floraclin"."users"("id"),
	"procedure_record_id" uuid REFERENCES "floraclin"."procedure_records"("id"),
	"procedure_session_id" uuid REFERENCES "floraclin"."procedure_sessions"("id") ON DELETE CASCADE,
	"origin" varchar(20) DEFAULT 'standalone' NOT NULL,
	"quotation_lines" jsonb,
	"declined_at" timestamp with time zone,
	"followup_snoozed_until" date,
	"last_contacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "face_diagram_groups_origin_check" CHECK ("origin" IN ('standalone', 'wizard'))
);--> statement-breakpoint
ALTER TABLE "floraclin"."face_diagram_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_face_diagram_groups_patient" ON "floraclin"."face_diagram_groups" ("tenant_id", "patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_face_diagram_groups_planning" ON "floraclin"."face_diagram_groups" ("procedure_record_id")
  WHERE "procedure_session_id" IS NULL AND "procedure_record_id" IS NOT NULL AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_face_diagram_groups_session" ON "floraclin"."face_diagram_groups" ("procedure_session_id")
  WHERE "procedure_session_id" IS NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "floraclin"."face_diagram_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
	"patient_id" uuid NOT NULL REFERENCES "floraclin"."patients"("id"),
	"group_id" uuid NOT NULL REFERENCES "floraclin"."face_diagram_groups"("id") ON DELETE CASCADE,
	"storage_path" text NOT NULL,
	"lines" jsonb NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"created_by" uuid NOT NULL REFERENCES "floraclin"."users"("id"),
	"whatsapp_status" varchar(10),
	"whatsapp_requested_at" timestamp with time zone,
	"whatsapp_message_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "face_diagram_quotes_whatsapp_status_check" CHECK ("whatsapp_status" IS NULL OR "whatsapp_status" IN ('queued', 'sent'))
);--> statement-breakpoint
ALTER TABLE "floraclin"."face_diagram_quotes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_face_diagram_quotes_group" ON "floraclin"."face_diagram_quotes" ("tenant_id", "group_id");--> statement-breakpoint

ALTER TABLE "floraclin"."face_diagrams"
  ADD COLUMN IF NOT EXISTS "group_id" uuid REFERENCES "floraclin"."face_diagram_groups"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_face_diagrams_group" ON "floraclin"."face_diagrams" ("group_id");--> statement-breakpoint

ALTER TABLE "floraclin"."procedure_records" ADD COLUMN IF NOT EXISTS "required_consent_types" jsonb;--> statement-breakpoint

ALTER TABLE "floraclin"."procedure_followups" ALTER COLUMN "procedure_record_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_followups"
  ADD COLUMN IF NOT EXISTS "face_diagram_group_id" uuid REFERENCES "floraclin"."face_diagram_groups"("id") ON DELETE CASCADE;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "floraclin"."procedure_followups"
	  ADD CONSTRAINT "procedure_followups_single_owner_check"
	  CHECK (num_nonnulls("procedure_record_id", "face_diagram_group_id") = 1);
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_procedure_followups_group_contacted" ON "floraclin"."procedure_followups" ("face_diagram_group_id", "contacted_at");--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'floraclin' AND table_name = 'face_diagrams'
      AND column_name = 'procedure_record_id'
  ) THEN
    ALTER TABLE "floraclin"."face_diagrams" ALTER COLUMN "procedure_record_id" DROP NOT NULL;

  INSERT INTO "floraclin"."face_diagram_groups" (
    "tenant_id", "patient_id", "practitioner_id", "procedure_record_id",
    "origin", "created_at", "updated_at"
  )
  SELECT pr."tenant_id", pr."patient_id", pr."practitioner_id", pr."id",
    'wizard', min(fd."created_at"), min(fd."created_at")
  FROM "floraclin"."procedure_records" pr
  JOIN "floraclin"."face_diagrams" fd
    ON fd."procedure_record_id" = pr."id"
   AND fd."procedure_session_id" IS NULL
   AND fd."group_id" IS NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM "floraclin"."face_diagram_groups" g
    WHERE g."procedure_record_id" = pr."id"
      AND g."procedure_session_id" IS NULL
      AND g."deleted_at" IS NULL
  )
  GROUP BY pr."id";

  UPDATE "floraclin"."face_diagrams" fd
  SET "group_id" = g."id"
  FROM "floraclin"."face_diagram_groups" g
  WHERE fd."group_id" IS NULL
    AND fd."procedure_session_id" IS NULL
    AND g."procedure_record_id" = fd."procedure_record_id"
    AND g."procedure_session_id" IS NULL
    AND g."deleted_at" IS NULL;

  INSERT INTO "floraclin"."face_diagram_groups" (
    "tenant_id", "patient_id", "practitioner_id", "procedure_record_id",
    "procedure_session_id", "origin", "created_at", "updated_at"
  )
  SELECT pr."tenant_id", pr."patient_id", COALESCE(ps."executed_by", pr."practitioner_id"),
    pr."id", ps."id", 'wizard', min(fd."created_at"), min(fd."created_at")
  FROM "floraclin"."procedure_sessions" ps
  JOIN "floraclin"."procedure_records" pr ON pr."id" = ps."procedure_record_id"
  JOIN "floraclin"."face_diagrams" fd
    ON fd."procedure_session_id" = ps."id"
   AND fd."group_id" IS NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM "floraclin"."face_diagram_groups" g
    WHERE g."procedure_session_id" = ps."id"
  )
  GROUP BY pr."id", ps."id";

  UPDATE "floraclin"."face_diagrams" fd
  SET "group_id" = g."id"
  FROM "floraclin"."face_diagram_groups" g
  WHERE fd."group_id" IS NULL
    AND fd."procedure_session_id" IS NOT NULL
    AND g."procedure_session_id" = fd."procedure_session_id";

  -- Legacy planning rows had no per-view unique index, so a group can hold several
  -- rows per view. Keep the newest and move the older rows' points onto it.
  WITH ranked AS (
    SELECT fd."id", first_value(fd."id") OVER (
      PARTITION BY fd."group_id", fd."view_type"
      ORDER BY fd."updated_at" DESC, fd."created_at" DESC, fd."id" DESC
    ) AS keep_id
    FROM "floraclin"."face_diagrams" fd
    WHERE fd."group_id" IS NOT NULL
  )
  UPDATE "floraclin"."diagram_points" dp
  SET "face_diagram_id" = r.keep_id
  FROM ranked r
  WHERE dp."face_diagram_id" = r."id" AND r."id" <> r.keep_id;

  DELETE FROM "floraclin"."face_diagrams" fd
  WHERE fd."group_id" IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "floraclin"."face_diagrams" newer
      WHERE newer."group_id" = fd."group_id"
        AND newer."view_type" = fd."view_type"
        AND (newer."updated_at", newer."created_at", newer."id") > (fd."updated_at", fd."created_at", fd."id")
    );
  END IF;
END $$;
