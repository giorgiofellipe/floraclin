ALTER TABLE "floraclin"."anamneses" ADD COLUMN "template_version" integer;
ALTER TABLE "floraclin"."anamneses" ADD COLUMN "template_snapshot" jsonb;
ALTER TABLE "floraclin"."anamneses" ADD COLUMN "responses" jsonb;

CREATE TABLE "floraclin"."anamnesis_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
  "sections" jsonb NOT NULL,
  "version" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "anamnesis_templates_tenant_id_unique" UNIQUE ("tenant_id")
);
ALTER TABLE "floraclin"."anamnesis_templates" ENABLE ROW LEVEL SECURITY;

-- Old code still writes the legacy columns during the deploy. Any such edit makes the converted
-- answers stale, so drop them and let the conversion script (responses IS NULL) redo the row.
-- Dropped in 0034 together with the legacy columns.
CREATE FUNCTION "floraclin"."anamneses_invalidate_converted"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.responses IS NOT DISTINCT FROM OLD.responses AND (
       NEW.main_complaint IS DISTINCT FROM OLD.main_complaint
    OR NEW.patient_goals IS DISTINCT FROM OLD.patient_goals
    OR NEW.medical_history IS DISTINCT FROM OLD.medical_history
    OR NEW.medications IS DISTINCT FROM OLD.medications
    OR NEW.allergies IS DISTINCT FROM OLD.allergies
    OR NEW.previous_surgeries IS DISTINCT FROM OLD.previous_surgeries
    OR NEW.chronic_conditions IS DISTINCT FROM OLD.chronic_conditions
    OR NEW.is_pregnant IS DISTINCT FROM OLD.is_pregnant
    OR NEW.is_breastfeeding IS DISTINCT FROM OLD.is_breastfeeding
    OR NEW.lifestyle IS DISTINCT FROM OLD.lifestyle
    OR NEW.skin_type IS DISTINCT FROM OLD.skin_type
    OR NEW.skin_conditions IS DISTINCT FROM OLD.skin_conditions
    OR NEW.skincare_routine IS DISTINCT FROM OLD.skincare_routine
    OR NEW.previous_aesthetic_treatments IS DISTINCT FROM OLD.previous_aesthetic_treatments
    OR NEW.contraindications IS DISTINCT FROM OLD.contraindications
    OR NEW.facial_evaluation_notes IS DISTINCT FROM OLD.facial_evaluation_notes
  ) THEN
    NEW.responses := NULL;
    NEW.template_snapshot := NULL;
    NEW.template_version := NULL;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "anamneses_invalidate_converted"
  BEFORE UPDATE ON "floraclin"."anamneses"
  FOR EACH ROW EXECUTE FUNCTION "floraclin"."anamneses_invalidate_converted"();
