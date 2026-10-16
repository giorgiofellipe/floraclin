ALTER TABLE "floraclin"."tenant_lifecycle_messages"
  ADD COLUMN "provider_message_id" varchar(255),
  ADD COLUMN "delivery_status" varchar(20),
  ADD COLUMN "delivered_at" timestamptz,
  ADD COLUMN "read_at" timestamptz,
  ADD COLUMN "failed_at" timestamptz,
  ADD COLUMN "error_code" varchar(50);

UPDATE "floraclin"."tenant_lifecycle_messages"
SET "delivery_status" = CASE
  WHEN "status" = 'sent' THEN 'sent'
  WHEN "status" = 'failed' THEN 'failed'
  ELSE NULL
END
WHERE "delivery_status" IS NULL;

CREATE INDEX "idx_tenant_lifecycle_messages_provider_id"
  ON "floraclin"."tenant_lifecycle_messages" ("provider_message_id");

ALTER TABLE "floraclin"."tenant_lifecycle_messages"
  ADD CONSTRAINT "tenant_lifecycle_messages_delivery_status_check"
  CHECK ("delivery_status" IS NULL OR "delivery_status" IN ('sent', 'delivered', 'read', 'failed'));

CREATE TABLE "floraclin"."tenant_lifecycle_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
  "lifecycle_message_id" uuid REFERENCES "floraclin"."tenant_lifecycle_messages"("id"),
  "message_key" varchar(40),
  "channel" varchar(10),
  "event_type" varchar(20) NOT NULL,
  "conversion_type" varchar(40),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tenant_lifecycle_events_type_check"
    CHECK ("event_type" IN ('click', 'activation', 'conversion')),
  CONSTRAINT "tenant_lifecycle_events_channel_check"
    CHECK ("channel" IS NULL OR "channel" IN ('whatsapp', 'email'))
);

CREATE INDEX "idx_tenant_lifecycle_events_tenant_created"
  ON "floraclin"."tenant_lifecycle_events" ("tenant_id", "created_at");
CREATE INDEX "idx_tenant_lifecycle_events_message"
  ON "floraclin"."tenant_lifecycle_events" ("lifecycle_message_id");
CREATE INDEX "idx_tenant_lifecycle_events_type"
  ON "floraclin"."tenant_lifecycle_events" ("event_type", "conversion_type");
CREATE UNIQUE INDEX "uq_tenant_lifecycle_activation_once"
  ON "floraclin"."tenant_lifecycle_events" ("tenant_id", "event_type", "conversion_type")
  WHERE "event_type" IN ('activation', 'conversion');

ALTER TABLE "floraclin"."tenant_lifecycle_events" ENABLE ROW LEVEL SECURITY;
