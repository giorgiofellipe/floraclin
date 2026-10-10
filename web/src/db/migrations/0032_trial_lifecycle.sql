ALTER TABLE "floraclin"."tenants" ADD COLUMN "lifecycle_notice_at" timestamptz;
ALTER TABLE "floraclin"."tenants" ADD COLUMN "lifecycle_opted_out_at" timestamptz;

CREATE TABLE "floraclin"."tenant_lifecycle_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
  "message_key" varchar(40) NOT NULL,
  "channel" varchar(10) NOT NULL,
  "status" varchar(10) NOT NULL,
  "recipient" varchar(255) NOT NULL,
  "claimed_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "meta_message_id" varchar(255),
  "error" text,
  CONSTRAINT "tenant_lifecycle_messages_channel_check" CHECK ("channel" IN ('whatsapp', 'email')),
  CONSTRAINT "tenant_lifecycle_messages_status_check" CHECK ("status" IN ('pending', 'sent', 'failed', 'skipped'))
);
CREATE UNIQUE INDEX "uq_tenant_lifecycle_message" ON "floraclin"."tenant_lifecycle_messages" ("tenant_id", "message_key", "channel");
CREATE INDEX "idx_tenant_lifecycle_messages_meta_id" ON "floraclin"."tenant_lifecycle_messages" ("meta_message_id");
CREATE INDEX "idx_tenant_lifecycle_messages_recipient" ON "floraclin"."tenant_lifecycle_messages" ("recipient");

CREATE TABLE "floraclin"."tenant_lifecycle_replies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
  "message_key" varchar(40) NOT NULL,
  "body" text NOT NULL,
  "meta_message_id" varchar(255) NOT NULL UNIQUE,
  "received_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_whatsapp_conversations_phone_last_message" ON "floraclin"."whatsapp_conversations" ("phone_number", "last_message_at");
