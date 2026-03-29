-- Procedure lifecycle redesign: map old statuses to new.
-- Run this AFTER the Drizzle migration 0002_tidy_unus.sql.

-- Drop old CHECK constraint on procedure_records.status (if it exists)
ALTER TABLE floraclin.procedure_records DROP CONSTRAINT IF EXISTS procedure_records_status_check;

-- Map old statuses to new
UPDATE floraclin.procedure_records SET status = 'executed' WHERE status = 'completed';
UPDATE floraclin.procedure_records SET status = 'planned' WHERE status = 'in_progress';
-- 'cancelled' stays as 'cancelled'

-- Add new CHECK constraint for procedure status
ALTER TABLE floraclin.procedure_records
  ADD CONSTRAINT procedure_records_status_check
  CHECK (status IN ('planned', 'approved', 'executed', 'cancelled'));

-- Drop old CHECK constraint on consent_templates.type (if it exists)
ALTER TABLE floraclin.consent_templates DROP CONSTRAINT IF EXISTS consent_templates_type_check;

-- Add new CHECK constraint for consent template type (includes service_contract)
ALTER TABLE floraclin.consent_templates
  ADD CONSTRAINT consent_templates_type_check
  CHECK (type IN ('general', 'botox', 'filler', 'biostimulator', 'custom', 'service_contract'));
