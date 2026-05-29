-- 0015: Package + atendimento redesign.
-- 1. Add new columns/tables.
-- 2. Backfill procedure_sessions from executed procedure_records.
-- 3. Backfill procedure_records.sessionsTotal and atendimentoId.
-- 4. (formerly drop step — renumbered) Materialize sold-but-unused package
--    lines into approved procedure_records so step-5 picker can see them.
-- 5. Drop patient_package_lines + its FK.
-- 6. Replace 'executed' with 'completed' in procedure_records.status CHECK.
--
-- DATA SAFETY: every row in patient_package_lines is preserved via the
-- step-4 materialization. After this migration runs, no clinical
-- information about sold packages is lost. The sort_order and
-- procedure_type_name snapshot columns are intentionally dropped —
-- procedure_type_name is re-derived live from procedure_types.name; order
-- now follows procedure_records.created_at.

-- ── 1. Schema additions ────────────────────────────────────────────────

-- procedure_records: new columns + widened status CHECK
ALTER TABLE "floraclin"."procedure_records"
  ADD COLUMN IF NOT EXISTS "sessions_total" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "atendimento_id" uuid;--> statement-breakpoint

ALTER TABLE "floraclin"."procedure_records"
  DROP CONSTRAINT IF EXISTS "procedure_records_status_check";--> statement-breakpoint

ALTER TABLE "floraclin"."procedure_records"
  ADD CONSTRAINT "procedure_records_status_check"
  CHECK ("status" IN ('draft', 'planned', 'approved', 'in_progress', 'completed', 'cancelled', 'executed'));--> statement-breakpoint
-- 'executed' is included temporarily; step 5 removes it after the backfill.

ALTER TABLE "floraclin"."procedure_records"
  ALTER COLUMN "performed_at" DROP NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_procedure_records_atendimento"
  ON "floraclin"."procedure_records" ("atendimento_id");--> statement-breakpoint

-- patient_packages: new close columns
ALTER TABLE "floraclin"."patient_packages"
  ADD COLUMN IF NOT EXISTS "closed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "closed_reason" varchar(50),
  ADD COLUMN IF NOT EXISTS "close_note" text;--> statement-breakpoint

ALTER TABLE "floraclin"."patient_packages"
  DROP CONSTRAINT IF EXISTS "patient_packages_closed_reason_check";--> statement-breakpoint

ALTER TABLE "floraclin"."patient_packages"
  ADD CONSTRAINT "patient_packages_closed_reason_check"
  CHECK ("closed_reason" IS NULL OR "closed_reason" IN ('patient_lost_expiry', 'patient_stopped_treatment', 'other'));--> statement-breakpoint

-- procedure_sessions: new table
CREATE TABLE IF NOT EXISTS "floraclin"."procedure_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
  "procedure_record_id" uuid NOT NULL REFERENCES "floraclin"."procedure_records"("id") ON DELETE CASCADE,
  "session_ordinal" integer NOT NULL,
  "performed_at" timestamptz NOT NULL,
  "executed_by" uuid NOT NULL REFERENCES "floraclin"."users"("id"),
  "technique" text,
  "clinical_response" text,
  "adverse_effects" text,
  "notes" text,
  "follow_up_date" date,
  "next_session_objectives" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_procedure_sessions_record_ordinal"
  ON "floraclin"."procedure_sessions" ("procedure_record_id", "session_ordinal");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_procedure_sessions_tenant_performed"
  ON "floraclin"."procedure_sessions" ("tenant_id", "performed_at");--> statement-breakpoint

-- product_applications: link to session
ALTER TABLE "floraclin"."product_applications"
  ADD COLUMN IF NOT EXISTS "procedure_session_id" uuid
    REFERENCES "floraclin"."procedure_sessions"("id");--> statement-breakpoint

-- photo_assets: link to session
ALTER TABLE "floraclin"."photo_assets"
  ADD COLUMN IF NOT EXISTS "procedure_session_id" uuid
    REFERENCES "floraclin"."procedure_sessions"("id");--> statement-breakpoint

-- face_diagrams: link to session
ALTER TABLE "floraclin"."face_diagrams"
  ADD COLUMN IF NOT EXISTS "procedure_session_id" uuid
    REFERENCES "floraclin"."procedure_sessions"("id");--> statement-breakpoint

-- Replace the record-scoped diagram uniqueness with session-scoped uniqueness.
DROP INDEX IF EXISTS "floraclin"."uq_face_diagrams_record_view";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_face_diagrams_session_view"
  ON "floraclin"."face_diagrams" ("procedure_session_id", "view_type")
  WHERE "procedure_session_id" IS NOT NULL;--> statement-breakpoint
-- Partial index — historical rows backfilled in step 2 of the migration already
-- have procedure_session_id set, but the WHERE clause protects us if any future
-- code path inserts a session-less diagram.

-- ── 2. Backfill procedure_sessions from executed records ──────────────

INSERT INTO "floraclin"."procedure_sessions" (
  "id", "tenant_id", "procedure_record_id", "session_ordinal",
  "performed_at", "executed_by", "technique", "clinical_response",
  "adverse_effects", "notes", "follow_up_date", "next_session_objectives",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  pr."tenant_id",
  pr."id",
  1, -- ordinal 1 for backfilled rows
  COALESCE(pr."performed_at", pr."created_at"),
  pr."practitioner_id",
  pr."technique",
  pr."clinical_response",
  pr."adverse_effects",
  pr."notes",
  pr."follow_up_date",
  pr."next_session_objectives",
  pr."created_at",
  pr."updated_at"
FROM "floraclin"."procedure_records" pr
WHERE pr."status" = 'executed'
  AND NOT EXISTS (
    SELECT 1 FROM "floraclin"."procedure_sessions" ps
    WHERE ps."procedure_record_id" = pr."id"
  );--> statement-breakpoint

-- Link side tables to the newly-created sessions
UPDATE "floraclin"."product_applications" pa
SET "procedure_session_id" = ps."id"
FROM "floraclin"."procedure_sessions" ps
WHERE pa."procedure_record_id" = ps."procedure_record_id"
  AND ps."session_ordinal" = 1
  AND pa."procedure_session_id" IS NULL;--> statement-breakpoint

UPDATE "floraclin"."photo_assets" ph
SET "procedure_session_id" = ps."id"
FROM "floraclin"."procedure_sessions" ps
WHERE ph."procedure_record_id" = ps."procedure_record_id"
  AND ps."session_ordinal" = 1
  AND ph."procedure_session_id" IS NULL;--> statement-breakpoint

UPDATE "floraclin"."face_diagrams" fd
SET "procedure_session_id" = ps."id"
FROM "floraclin"."procedure_sessions" ps
WHERE fd."procedure_record_id" = ps."procedure_record_id"
  AND ps."session_ordinal" = 1
  AND fd."procedure_session_id" IS NULL;--> statement-breakpoint

-- Flip 'executed' to 'completed'
UPDATE "floraclin"."procedure_records"
SET "status" = 'completed'
WHERE "status" = 'executed';--> statement-breakpoint

-- ── 3. Backfill procedure_records.sessions_total from patient_package_lines ──

UPDATE "floraclin"."procedure_records" pr
SET "sessions_total" = COALESCE(ppl."sessions_total", 1)
FROM "floraclin"."patient_package_lines" ppl
WHERE pr."patient_package_line_id" = ppl."id"
  AND pr."patient_package_line_id" IS NOT NULL;--> statement-breakpoint

-- ── 4. Backfill atendimento_id ────────────────────────────────────────

-- Procedures that belonged to a package share that package id as atendimentoId
UPDATE "floraclin"."procedure_records"
SET "atendimento_id" = "patient_package_id"
WHERE "atendimento_id" IS NULL
  AND "patient_package_id" IS NOT NULL;--> statement-breakpoint

-- Every remaining procedure becomes its own atendimento
UPDATE "floraclin"."procedure_records"
SET "atendimento_id" = gen_random_uuid()
WHERE "atendimento_id" IS NULL;--> statement-breakpoint

-- ── 5. Materialize procedure_records for sold-but-unused package lines ──
--
-- Pre-redesign, `sellPackage` created `patient_package_lines` rows but did
-- NOT create `procedure_records` upfront — records were created lazily by
-- `startPackageSession` on first execution. So a package that was sold,
-- consented to, and paid for, but where no session has been executed yet,
-- has lines but ZERO procedure_records.
--
-- Without this step, dropping `patient_package_lines` would erase what
-- those packages were sold to deliver: the new step-5 picker would see an
-- empty atendimento for the package, and clinicians would have no record
-- of the agreed sessions.
--
-- This INSERT materializes one `approved` procedure_records row per orphan
-- line, anchored to the same `patient_packages.id` as the atendimento
-- grouping. The package's purchase date stamps `approved_at` / timestamps.
-- Idempotent via the NOT EXISTS guard.

INSERT INTO "floraclin"."procedure_records" (
  "id", "tenant_id", "patient_id", "practitioner_id", "procedure_type_id",
  "status", "approved_at", "sessions_total", "atendimento_id",
  "patient_package_id", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  pp."tenant_id",
  pp."patient_id",
  pp."sold_by",
  ppl."procedure_type_id",
  'approved',
  pp."created_at",
  ppl."sessions_total",
  pp."id",       -- atendimento groups by package id (matches step 4 backfill)
  pp."id",
  pp."created_at",
  pp."created_at"
FROM "floraclin"."patient_package_lines" ppl
INNER JOIN "floraclin"."patient_packages" pp
  ON ppl."patient_package_id" = pp."id"
WHERE NOT EXISTS (
  SELECT 1 FROM "floraclin"."procedure_records" pr
  WHERE pr."patient_package_line_id" = ppl."id"
);--> statement-breakpoint

-- ── 6. Drop patient_package_lines + related FK ────────────────────────

ALTER TABLE "floraclin"."procedure_records"
  DROP CONSTRAINT IF EXISTS "procedure_records_patient_package_line_id_patient_package_lines_id_fk";--> statement-breakpoint

DROP INDEX IF EXISTS "floraclin"."idx_procedure_records_package_line";--> statement-breakpoint

ALTER TABLE "floraclin"."procedure_records"
  DROP COLUMN IF EXISTS "patient_package_line_id";--> statement-breakpoint

DROP TABLE IF EXISTS "floraclin"."patient_package_lines";--> statement-breakpoint

-- ── 7. Remove 'executed' from procedure_records.status CHECK ──────────

ALTER TABLE "floraclin"."procedure_records"
  DROP CONSTRAINT IF EXISTS "procedure_records_status_check";--> statement-breakpoint

ALTER TABLE "floraclin"."procedure_records"
  ADD CONSTRAINT "procedure_records_status_check"
  CHECK ("status" IN ('draft', 'planned', 'approved', 'in_progress', 'completed', 'cancelled'));--> statement-breakpoint
