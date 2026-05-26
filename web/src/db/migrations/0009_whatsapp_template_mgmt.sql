-- Add new columns to whatsapp_templates
ALTER TABLE "floraclin"."whatsapp_templates"
  ALTER COLUMN "meta_template_id" DROP NOT NULL;

ALTER TABLE "floraclin"."whatsapp_templates"
  ADD COLUMN IF NOT EXISTS "purpose_key" varchar(100),
  ADD COLUMN IF NOT EXISTS "rejected_reason" text,
  ADD COLUMN IF NOT EXISTS "blueprint_slug" varchar(100),
  ADD COLUMN IF NOT EXISTS "submitted_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "variable_mapping" jsonb;

-- Unique constraint: at most one template per purpose per tenant
CREATE UNIQUE INDEX IF NOT EXISTS "uq_whatsapp_templates_tenant_purpose"
  ON "floraclin"."whatsapp_templates" ("tenant_id", "purpose_key")
  WHERE "purpose_key" IS NOT NULL;

-- Automations table
CREATE TABLE IF NOT EXISTS "floraclin"."whatsapp_automations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
  "trigger" varchar(50) NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "template_id" uuid REFERENCES "floraclin"."whatsapp_templates"("id") ON DELETE SET NULL,
  "config" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_whatsapp_automations_tenant_trigger"
  ON "floraclin"."whatsapp_automations" ("tenant_id", "trigger");
