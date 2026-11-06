-- Bank reconciliation, part 1 (#137): OFX statement imports, statement lines and allocations.
-- Additive only: nothing existing is changed except one UNIQUE (tenant_id, id) on cash_movements, which
-- the allocation table needs to prove a movement belongs to the same clinic. Safe to apply before the
-- deploy that uses it; old code never reads or writes these tables. Idempotent: re-running is a no-op.
--
-- bank_statement_imports         one row per accepted upload (the same statement twice is refused)
-- bank_statement_lines           immutable statement lines; only the ignore / review columns ever change,
--                                and created_expense_id is set once when a debit becomes an expense
-- bank_reconciliation_allocations  explicit cents linking a line to a ledger movement; undone, never deleted
--
-- The database, not only the app, refuses what would corrupt a reconciliation: a trigger locks the line
-- and the movement, requires the same clinic, the same account and the same direction, and keeps the
-- active allocations of each side at or below its own amount, so two concurrent matches cannot
-- double-allocate.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_movements_tenant_id_id_key') THEN
    ALTER TABLE "floraclin"."cash_movements" ADD CONSTRAINT "cash_movements_tenant_id_id_key" UNIQUE ("tenant_id", "id");
  END IF;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floraclin"."bank_statement_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"statement_hash" char(64) NOT NULL,
	"bank_id" varchar(30),
	"bank_account_id" varchar(50),
	"period_start" date,
	"period_end" date,
	"total_lines" integer NOT NULL,
	"new_lines" integer NOT NULL,
	"duplicate_lines" integer NOT NULL,
	"suspect_lines" integer NOT NULL,
	"imported_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_statement_imports_tenant_id_id_key" UNIQUE ("tenant_id", "id"),
	CONSTRAINT "bank_statement_imports_account_fk" FOREIGN KEY ("tenant_id", "account_id") REFERENCES "floraclin"."financial_accounts"("tenant_id", "id"),
	CONSTRAINT "bank_statement_imports_user_fk" FOREIGN KEY ("imported_by") REFERENCES "floraclin"."users"("id"),
	CONSTRAINT "bank_statement_imports_counts_check" CHECK ("total_lines" >= 0 AND "new_lines" >= 0 AND "duplicate_lines" >= 0 AND "new_lines" + "duplicate_lines" = "total_lines")
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_bank_statement_imports_hash" ON "floraclin"."bank_statement_imports" ("tenant_id", "account_id", "statement_hash");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floraclin"."bank_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"posted_date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"fitid" varchar(100),
	"memo" varchar(255) NOT NULL,
	"trn_type" varchar(20),
	"check_number" varchar(30),
	"identity_key" char(64) NOT NULL,
	"occurrence" integer NOT NULL,
	"fingerprint" char(64) NOT NULL,
	"suspected_duplicate_of" uuid,
	"suspect_reviewed_at" timestamp with time zone,
	"suspect_reviewed_by" uuid,
	"ignored_at" timestamp with time zone,
	"ignored_by" uuid,
	"ignore_reason" varchar(255),
	"created_expense_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_statement_lines_tenant_id_id_key" UNIQUE ("tenant_id", "id"),
	CONSTRAINT "bank_statement_lines_account_fk" FOREIGN KEY ("tenant_id", "account_id") REFERENCES "floraclin"."financial_accounts"("tenant_id", "id"),
	CONSTRAINT "bank_statement_lines_import_fk" FOREIGN KEY ("tenant_id", "import_id") REFERENCES "floraclin"."bank_statement_imports"("tenant_id", "id"),
	CONSTRAINT "bank_statement_lines_suspect_fk" FOREIGN KEY ("tenant_id", "suspected_duplicate_of") REFERENCES "floraclin"."bank_statement_lines"("tenant_id", "id"),
	CONSTRAINT "bank_statement_lines_created_expense_fk" FOREIGN KEY ("created_expense_id") REFERENCES "floraclin"."expenses"("id"),
	CONSTRAINT "bank_statement_lines_amount_check" CHECK ("amount_cents" <> 0),
	CONSTRAINT "bank_statement_lines_occurrence_check" CHECK ("occurrence" >= 1),
	CONSTRAINT "bank_statement_lines_ignore_check" CHECK (("ignored_at" IS NULL) = ("ignore_reason" IS NULL) AND ("ignored_at" IS NULL) = ("ignored_by" IS NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_bank_statement_lines_identity" ON "floraclin"."bank_statement_lines" ("tenant_id", "account_id", "identity_key", "occurrence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_statement_lines_account_date" ON "floraclin"."bank_statement_lines" ("tenant_id", "account_id", "posted_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_statement_lines_fingerprint" ON "floraclin"."bank_statement_lines" ("tenant_id", "account_id", "fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_statement_lines_import" ON "floraclin"."bank_statement_lines" ("import_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_statement_lines_fitid" ON "floraclin"."bank_statement_lines" ("tenant_id", "account_id", "fitid") WHERE "fitid" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_bank_statement_lines_created_expense" ON "floraclin"."bank_statement_lines" ("created_expense_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floraclin"."bank_reconciliation_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" uuid,
	CONSTRAINT "bank_reconciliation_allocations_account_fk" FOREIGN KEY ("tenant_id", "account_id") REFERENCES "floraclin"."financial_accounts"("tenant_id", "id"),
	CONSTRAINT "bank_reconciliation_allocations_line_fk" FOREIGN KEY ("tenant_id", "line_id") REFERENCES "floraclin"."bank_statement_lines"("tenant_id", "id"),
	CONSTRAINT "bank_reconciliation_allocations_movement_fk" FOREIGN KEY ("tenant_id", "movement_id") REFERENCES "floraclin"."cash_movements"("tenant_id", "id"),
	CONSTRAINT "bank_reconciliation_allocations_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "floraclin"."users"("id"),
	CONSTRAINT "bank_reconciliation_allocations_undone_by_fk" FOREIGN KEY ("undone_by") REFERENCES "floraclin"."users"("id"),
	CONSTRAINT "bank_reconciliation_allocations_amount_check" CHECK ("amount_cents" > 0),
	CONSTRAINT "bank_reconciliation_allocations_undone_check" CHECK (("undone_at" IS NULL) = ("undone_by" IS NULL))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_allocations_line" ON "floraclin"."bank_reconciliation_allocations" ("tenant_id", "line_id") WHERE "undone_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_allocations_movement" ON "floraclin"."bank_reconciliation_allocations" ("tenant_id", "movement_id") WHERE "undone_at" IS NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "floraclin"."bank_allocation_guard"() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  l RECORD;
  m RECORD;
  line_used bigint;
  movement_used bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- An allocation is never edited; the only change is being undone, once.
    IF OLD.undone_at IS NOT NULL
       OR NEW.undone_at IS NULL
       OR NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.account_id <> OLD.account_id
       OR NEW.line_id <> OLD.line_id OR NEW.movement_id <> OLD.movement_id
       OR NEW.amount_cents <> OLD.amount_cents OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'bank_reconciliation_allocations are append-only: an allocation can only be undone' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'a new allocation cannot be created already undone' USING ERRCODE = '23514';
  END IF;

  -- Lock order is always line first, then movement.
  SELECT * INTO l FROM "floraclin"."bank_statement_lines" WHERE id = NEW.line_id AND tenant_id = NEW.tenant_id FOR UPDATE;
  SELECT * INTO m FROM "floraclin"."cash_movements" WHERE id = NEW.movement_id AND tenant_id = NEW.tenant_id FOR UPDATE;
  IF l.id IS NULL OR m.id IS NULL THEN
    RAISE EXCEPTION 'allocation line or movement not found for this clinic' USING ERRCODE = '23503';
  END IF;
  IF l.account_id <> NEW.account_id OR m.account_id IS DISTINCT FROM NEW.account_id THEN
    RAISE EXCEPTION 'allocation must stay inside one account' USING ERRCODE = '23514';
  END IF;
  IF l.ignored_at IS NOT NULL THEN
    RAISE EXCEPTION 'an ignored statement line cannot be allocated' USING ERRCODE = '23514';
  END IF;
  IF (l.amount_cents > 0) <> (m.type = 'inflow') THEN
    RAISE EXCEPTION 'a credit matches inflows and a debit matches outflows' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0) INTO line_used FROM "floraclin"."bank_reconciliation_allocations"
    WHERE tenant_id = NEW.tenant_id AND line_id = NEW.line_id AND undone_at IS NULL;
  IF line_used + NEW.amount_cents > abs(l.amount_cents) THEN
    RAISE EXCEPTION 'statement line over-allocated' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0) INTO movement_used FROM "floraclin"."bank_reconciliation_allocations"
    WHERE tenant_id = NEW.tenant_id AND movement_id = NEW.movement_id AND undone_at IS NULL;
  IF movement_used + NEW.amount_cents > round(m.amount * 100)::bigint THEN
    RAISE EXCEPTION 'ledger movement over-allocated' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$fn$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "bank_allocation_guard" ON "floraclin"."bank_reconciliation_allocations";--> statement-breakpoint
CREATE TRIGGER "bank_allocation_guard" BEFORE INSERT OR UPDATE ON "floraclin"."bank_reconciliation_allocations"
  FOR EACH ROW EXECUTE FUNCTION "floraclin"."bank_allocation_guard"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "floraclin"."bank_ledger_no_delete"() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME USING ERRCODE = '23514';
END
$fn$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "bank_ledger_no_delete" ON "floraclin"."bank_reconciliation_allocations";--> statement-breakpoint
CREATE TRIGGER "bank_ledger_no_delete" BEFORE DELETE ON "floraclin"."bank_reconciliation_allocations"
  FOR EACH ROW EXECUTE FUNCTION "floraclin"."bank_ledger_no_delete"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "bank_statement_lines_no_delete" ON "floraclin"."bank_statement_lines";--> statement-breakpoint
CREATE TRIGGER "bank_statement_lines_no_delete" BEFORE DELETE ON "floraclin"."bank_statement_lines"
  FOR EACH ROW EXECUTE FUNCTION "floraclin"."bank_ledger_no_delete"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "floraclin"."bank_statement_line_guard"() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  -- Statement text is immutable; only the ignore and duplicate-review columns change.
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.account_id <> OLD.account_id
     OR NEW.import_id <> OLD.import_id OR NEW.posted_date <> OLD.posted_date
     OR NEW.amount_cents <> OLD.amount_cents OR NEW.fitid IS DISTINCT FROM OLD.fitid
     OR NEW.memo <> OLD.memo OR NEW.trn_type IS DISTINCT FROM OLD.trn_type
     OR NEW.check_number IS DISTINCT FROM OLD.check_number
     OR NEW.identity_key <> OLD.identity_key OR NEW.occurrence <> OLD.occurrence
     OR NEW.fingerprint <> OLD.fingerprint
     OR NEW.suspected_duplicate_of IS DISTINCT FROM OLD.suspected_duplicate_of
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'bank statement lines are immutable' USING ERRCODE = '23514';
  END IF;
  -- The expense created from a line is recorded once and kept, even after the
  -- match is undone, so the same debit can never create a second expense.
  IF OLD.created_expense_id IS NOT NULL AND NEW.created_expense_id IS DISTINCT FROM OLD.created_expense_id THEN
    RAISE EXCEPTION 'the expense created from a statement line cannot change' USING ERRCODE = '23514';
  END IF;
  IF NEW.ignored_at IS NOT NULL AND OLD.ignored_at IS NULL THEN
    PERFORM 1 FROM "floraclin"."bank_reconciliation_allocations"
      WHERE tenant_id = NEW.tenant_id AND line_id = NEW.id AND undone_at IS NULL;
    IF FOUND THEN
      RAISE EXCEPTION 'a statement line with active allocations cannot be ignored' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "bank_statement_line_guard" ON "floraclin"."bank_statement_lines";--> statement-breakpoint
CREATE TRIGGER "bank_statement_line_guard" BEFORE UPDATE ON "floraclin"."bank_statement_lines"
  FOR EACH ROW EXECUTE FUNCTION "floraclin"."bank_statement_line_guard"();
