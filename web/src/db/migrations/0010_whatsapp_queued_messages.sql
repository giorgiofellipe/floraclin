CREATE TABLE IF NOT EXISTS floraclin.whatsapp_queued_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  conversation_id UUID NOT NULL REFERENCES floraclin.whatsapp_conversations(id),
  body TEXT,
  media_type VARCHAR(20),
  media_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'expired')),
  resume_meta_message_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ
);

CREATE INDEX idx_whatsapp_queued_messages_conv_status
  ON floraclin.whatsapp_queued_messages (conversation_id, status);

CREATE INDEX idx_whatsapp_queued_messages_tenant_created
  ON floraclin.whatsapp_queued_messages (tenant_id, created_at);
