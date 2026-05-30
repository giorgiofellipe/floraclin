-- Evidence columns on consent_acceptances
ALTER TABLE floraclin.consent_acceptances
  ADD COLUMN signature_evidence JSONB,
  ADD COLUMN verification_code VARCHAR(16) UNIQUE;

-- Verification code on clinical_documents
ALTER TABLE floraclin.clinical_documents
  ADD COLUMN verification_code VARCHAR(16) UNIQUE;

-- Remote consent signing tokens
CREATE TABLE floraclin.consent_signing_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token VARCHAR(64) UNIQUE NOT NULL,
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  patient_id UUID NOT NULL REFERENCES floraclin.patients(id),
  procedure_record_id UUID NOT NULL REFERENCES floraclin.procedure_records(id),
  consent_template_ids UUID[] NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES floraclin.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_consent_signing_tokens_token ON floraclin.consent_signing_tokens(token);
CREATE INDEX idx_consent_signing_tokens_tenant ON floraclin.consent_signing_tokens(tenant_id);

-- Audit log immutability trigger (Lei 13.787 Art. 6°)
CREATE OR REPLACE FUNCTION floraclin.prevent_audit_modification() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs table is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON floraclin.audit_logs
  FOR EACH ROW EXECUTE FUNCTION floraclin.prevent_audit_modification();
