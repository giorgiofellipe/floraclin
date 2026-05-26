ALTER TABLE "floraclin"."prospects" ADD COLUMN IF NOT EXISTS "value" numeric(10, 2);

-- Junction table for prospect ↔ procedure_types relationship
CREATE TABLE IF NOT EXISTS "floraclin"."prospect_procedure_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
  "prospect_id" uuid NOT NULL REFERENCES "floraclin"."prospects"("id"),
  "procedure_type_id" uuid NOT NULL REFERENCES "floraclin"."procedure_types"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_prospect_procedure_type"
  ON "floraclin"."prospect_procedure_types" ("prospect_id", "procedure_type_id");
CREATE INDEX IF NOT EXISTS "idx_prospect_procedure_types_prospect"
  ON "floraclin"."prospect_procedure_types" ("prospect_id");

-- Migrate interested_procedures jsonb → junction table rows
INSERT INTO "floraclin"."prospect_procedure_types" ("tenant_id", "prospect_id", "procedure_type_id")
SELECT p."tenant_id", p."id", pt."id"
FROM "floraclin"."prospects" p
CROSS JOIN LATERAL jsonb_array_elements_text(p."interested_procedures") AS proc_name
JOIN "floraclin"."procedure_types" pt
  ON pt."tenant_id" = p."tenant_id"
  AND lower(pt."name") = lower(proc_name)
WHERE p."interested_procedures" IS NOT NULL
  AND jsonb_array_length(p."interested_procedures") > 0
ON CONFLICT DO NOTHING;

-- Drop old columns
ALTER TABLE "floraclin"."prospects" DROP COLUMN IF EXISTS "interested_procedures";
ALTER TABLE "floraclin"."prospects" DROP COLUMN IF EXISTS "interested_procedure";
