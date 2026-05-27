-- Allow multiple prospects per phone by replacing the absolute unique index
-- with a partial one that only enforces uniqueness for active (non-terminal) leads.
-- Closed leads (convertido/perdido) can coexist with a new active lead.

DROP INDEX IF EXISTS floraclin.uq_prospects_tenant_phone;

CREATE UNIQUE INDEX uq_prospects_tenant_phone
  ON floraclin.prospects (tenant_id, phone)
  WHERE stage NOT IN ('convertido', 'perdido');
