-- 0016: Patient evoluções — clinical narrative tab.
-- 1. patient_evolutions: loose notes (free-text, patient-level, soft-deletable)
-- 2. patient_evolution_revisions: edit history snapshots (cascade-deleted with parent)

CREATE TABLE IF NOT EXISTS "floraclin"."patient_evolutions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
  "patient_id" uuid NOT NULL REFERENCES "floraclin"."patients"("id"),
  "body" text NOT NULL,
  "author_id" uuid NOT NULL REFERENCES "floraclin"."users"("id"),
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "floraclin"."users"("id"),
  "delete_reason" text
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_patient_evolutions_feed"
  ON "floraclin"."patient_evolutions" ("tenant_id", "patient_id", "occurred_at" DESC);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_patient_evolutions_author"
  ON "floraclin"."patient_evolutions" ("tenant_id", "author_id");--> statement-breakpoint

-- RA-10: Cascade is intentional; hard-delete of soft-deleted notes is not performed today, but if a maintenance job is added later, revisions will be removed with the parent.
CREATE TABLE IF NOT EXISTS "floraclin"."patient_evolution_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
  "evolution_id" uuid NOT NULL REFERENCES "floraclin"."patient_evolutions"("id") ON DELETE CASCADE,
  "body" text NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "edited_by" uuid NOT NULL REFERENCES "floraclin"."users"("id"),
  "edited_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_patient_evolution_revisions_evolution"
  ON "floraclin"."patient_evolution_revisions" ("evolution_id", "edited_at" DESC);--> statement-breakpoint
