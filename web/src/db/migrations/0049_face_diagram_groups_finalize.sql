-- Standalone face diagrams, part 2 of 2. Apply by hand AFTER the deploy that stops
-- reading face_diagrams.procedure_record_id / procedure_session_id is live and old
-- instances have drained (at least one hour). Re-backfills rows old code wrote
-- after 0048, then enforces group_id and drops the legacy columns.
-- Idempotent; re-running after the columns are gone is a no-op.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'floraclin' AND table_name = 'face_diagrams'
      AND column_name = 'procedure_record_id'
  ) THEN
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
  END IF;
END $$;--> statement-breakpoint
-- Same merge as 0048, for duplicate views old code wrote after 0048 ran.
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
WHERE dp."face_diagram_id" = r."id" AND r."id" <> r.keep_id;--> statement-breakpoint
DELETE FROM "floraclin"."face_diagrams" fd
WHERE fd."group_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "floraclin"."face_diagrams" newer
    WHERE newer."group_id" = fd."group_id"
      AND newer."view_type" = fd."view_type"
      AND (newer."updated_at", newer."created_at", newer."id") > (fd."updated_at", fd."created_at", fd."id")
  );--> statement-breakpoint
ALTER TABLE "floraclin"."face_diagrams" ALTER COLUMN "group_id" SET NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "floraclin"."uq_face_diagrams_session_view";--> statement-breakpoint
ALTER TABLE "floraclin"."face_diagrams" DROP COLUMN IF EXISTS "procedure_session_id";--> statement-breakpoint
ALTER TABLE "floraclin"."face_diagrams" DROP COLUMN IF EXISTS "procedure_record_id";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_face_diagrams_group_view" ON "floraclin"."face_diagrams" ("group_id", "view_type");
