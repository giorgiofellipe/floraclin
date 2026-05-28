-- Instagram DM integration: new tables, prospect IG columns, SSE channel.

-- ─── INSTAGRAM CONVERSATIONS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS floraclin.instagram_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  igsid VARCHAR(64) NOT NULL,
  ig_handle VARCHAR(255),
  ig_profile_name VARCHAR(255),
  ig_profile_picture_url TEXT,
  prospect_id UUID REFERENCES floraclin.prospects(id),
  patient_id UUID REFERENCES floraclin.patients(id),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_inbound_at TIMESTAMPTZ,
  unread_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_instagram_conversations_tenant_igsid
  ON floraclin.instagram_conversations (tenant_id, igsid);

CREATE INDEX IF NOT EXISTS idx_instagram_conversations_tenant_last_msg
  ON floraclin.instagram_conversations (tenant_id, last_message_at);

CREATE INDEX IF NOT EXISTS idx_instagram_conversations_prospect
  ON floraclin.instagram_conversations (prospect_id);

CREATE INDEX IF NOT EXISTS idx_instagram_conversations_patient
  ON floraclin.instagram_conversations (patient_id);

-- ─── INSTAGRAM MESSAGES ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS floraclin.instagram_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  conversation_id UUID NOT NULL REFERENCES floraclin.instagram_conversations(id),
  direction VARCHAR(10) NOT NULL,
  message_type VARCHAR(30) NOT NULL DEFAULT 'text',
  meta_message_id VARCHAR(255),
  body TEXT,
  media_type VARCHAR(20),
  media_url TEXT,
  media_filename VARCHAR(500),
  story_media_url TEXT,
  story_id VARCHAR(255),
  reaction_emoji VARCHAR(16),
  reacts_to_message_id UUID,
  delivery_status VARCHAR(20) NOT NULL DEFAULT 'sent',
  message_tag VARCHAR(30),
  error_code VARCHAR(50),
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_instagram_messages_conversation_ts
  ON floraclin.instagram_messages (conversation_id, "timestamp");

CREATE UNIQUE INDEX IF NOT EXISTS uq_instagram_messages_meta_id
  ON floraclin.instagram_messages (meta_message_id)
  WHERE meta_message_id IS NOT NULL;

-- Reactions: prevent duplicate rows on webhook retry. A given conversation
-- can only have one inbound (or one outbound) reaction row per target msg.
CREATE UNIQUE INDEX IF NOT EXISTS uq_instagram_messages_reaction
  ON floraclin.instagram_messages (conversation_id, reacts_to_message_id, direction)
  WHERE message_type = 'reaction';

-- ─── INSTAGRAM SAVED REPLIES ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS floraclin.instagram_saved_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  name VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  variable_keys TEXT[] NOT NULL DEFAULT '{}'::text[],
  purpose_key VARCHAR(100),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_instagram_saved_replies_tenant_name
  ON floraclin.instagram_saved_replies (tenant_id, name)
  WHERE archived_at IS NULL;

-- ─── PROSPECTS: IG identity columns + indexes ───────────────────────
ALTER TABLE floraclin.prospects
  ADD COLUMN IF NOT EXISTS igsid VARCHAR(64),
  ADD COLUMN IF NOT EXISTS ig_handle VARCHAR(255);

-- IG-sourced prospects have no phone; relax the NOT NULL constraint.
-- The existing partial unique index on (tenant_id, phone) WHERE stage NOT IN (...)
-- continues to work for non-NULL phones (Postgres treats NULL as distinct in unique indexes).
ALTER TABLE floraclin.prospects
  ALTER COLUMN phone DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prospects_tenant_igsid
  ON floraclin.prospects (tenant_id, igsid)
  WHERE igsid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_prospects_tenant_igsid_active
  ON floraclin.prospects (tenant_id, igsid)
  WHERE igsid IS NOT NULL AND stage NOT IN ('convertido', 'perdido');

-- ─── SSE EVENTS: channel discriminator ──────────────────────────────
ALTER TABLE floraclin.sse_events
  ADD COLUMN IF NOT EXISTS channel VARCHAR(20) NOT NULL DEFAULT 'whatsapp';
