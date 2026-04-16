-- Add 'draft' to the procedure lifecycle.
-- A draft procedure has been saved mid-planning (e.g. via "Salvar e sair") but
-- does not yet satisfy the final-mode validation (financialPlan + diagram points).
-- When the user returns to the wizard, a draft procedure reopens at the
-- planning step so they can finish filling it in. Only 'planned' procedures
-- are eligible for approval.

ALTER TABLE floraclin.procedure_records DROP CONSTRAINT IF EXISTS procedure_records_status_check;

ALTER TABLE floraclin.procedure_records
  ADD CONSTRAINT procedure_records_status_check
  CHECK (status IN ('draft', 'planned', 'approved', 'executed', 'cancelled'));
