-- Google Calendar sync: new tables and appointment columns

-- New columns on appointments for Google event tracking
ALTER TABLE floraclin.appointments
  ADD COLUMN IF NOT EXISTS google_event_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS clinic_google_event_id VARCHAR(255);

-- Calendar connections (one per practitioner per tenant, one clinic-level per tenant)
CREATE TABLE IF NOT EXISTS floraclin.calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  user_id UUID REFERENCES floraclin.users(id),
  provider VARCHAR(20) NOT NULL DEFAULT 'google',
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  calendar_id VARCHAR(255) NOT NULL DEFAULT 'primary',
  sync_token TEXT,
  channel_id VARCHAR(255),
  channel_resource_id VARCHAR(255),
  channel_expiry TIMESTAMPTZ,
  feed_token VARCHAR(64) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial unique: one practitioner connection per tenant
CREATE UNIQUE INDEX uq_calendar_connections_tenant_user
  ON floraclin.calendar_connections (tenant_id, user_id)
  WHERE user_id IS NOT NULL;

-- Partial unique: one clinic-level connection per tenant
CREATE UNIQUE INDEX uq_calendar_connections_tenant_clinic
  ON floraclin.calendar_connections (tenant_id)
  WHERE user_id IS NULL;

CREATE INDEX idx_calendar_connections_tenant
  ON floraclin.calendar_connections (tenant_id);

CREATE INDEX idx_calendar_connections_channel
  ON floraclin.calendar_connections (channel_id);

CREATE UNIQUE INDEX uq_calendar_connections_feed_token
  ON floraclin.calendar_connections (feed_token);

-- Calendar blocks (external events blocking practitioner availability)
CREATE TABLE IF NOT EXISTS floraclin.calendar_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  practitioner_id UUID NOT NULL REFERENCES floraclin.users(id),
  connection_id UUID NOT NULL REFERENCES floraclin.calendar_connections(id) ON DELETE CASCADE,
  google_event_id VARCHAR(255) NOT NULL,
  title VARCHAR(255),
  date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  all_day BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_calendar_blocks_practitioner_date
  ON floraclin.calendar_blocks (tenant_id, practitioner_id, date);

CREATE UNIQUE INDEX uq_calendar_blocks_connection_event
  ON floraclin.calendar_blocks (connection_id, google_event_id);
