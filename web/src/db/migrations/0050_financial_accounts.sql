-- Finance accounts, part 1 of 2 (expand). Additive only: safe to apply before the deploy that uses it,
-- and old code keeps working against it (it never reads or writes the new columns).
--
-- financial_accounts holds the clinic's bank, cash (caixa) and acquirer accounts. Every cash_movements
-- row gets an account_id; it stays nullable here because the deployed code does not set it yet.
-- The (tenant_id, account_id) foreign keys make the database refuse a movement or a terminal that points
-- at another clinic's account.
--
-- Each clinic that already has movements gets one 'legacy' account, "Geral (antes das contas)", and all
-- its existing movements are attributed to it. That claims nothing about which bank or drawer the money
-- went through, keeps every ledger total identical, and carries no opening balance, so no historical
-- movement is counted twice. Until the clinic sets default accounts, new movements also land there.
--
-- Rollout:
--   1. Apply this file.
--   2. Deploy the code that writes account_id on every movement.
--   3. After old instances have drained (at least one hour), apply 0051_financial_accounts_contract.sql,
--      which re-runs this backfill for rows old code wrote in between, checks none is left and only then
--      sets account_id NOT NULL.
-- Idempotent: re-running is a no-op.
CREATE TABLE IF NOT EXISTS "floraclin"."financial_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"bank_name" varchar(100),
	"bank_agency" varchar(20),
	"bank_account" varchar(30),
	"is_default" boolean DEFAULT false NOT NULL,
	"opening_balance" numeric(12,2) DEFAULT '0' NOT NULL,
	"opening_balance_date" date,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id"),
	CONSTRAINT "financial_accounts_tenant_id_id_key" UNIQUE ("tenant_id", "id"),
	CONSTRAINT "financial_accounts_kind_check" CHECK ("kind" IN ('bank', 'cash', 'acquirer', 'legacy')),
	CONSTRAINT "financial_accounts_default_kind_check" CHECK (NOT "is_default" OR "kind" IN ('bank', 'cash')),
	CONSTRAINT "financial_accounts_opening_check" CHECK ("opening_balance" = 0 OR "opening_balance_date" IS NOT NULL)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_financial_accounts_default" ON "floraclin"."financial_accounts" ("tenant_id", "kind") WHERE "is_default" AND "archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_financial_accounts_legacy" ON "floraclin"."financial_accounts" ("tenant_id") WHERE "kind" = 'legacy';--> statement-breakpoint
ALTER TABLE "floraclin"."cash_movements" ADD COLUMN IF NOT EXISTS "account_id" uuid;--> statement-breakpoint
ALTER TABLE "floraclin"."cash_movements" ADD COLUMN IF NOT EXISTS "transfer_group_id" uuid;--> statement-breakpoint
ALTER TABLE "floraclin"."card_terminals" ADD COLUMN IF NOT EXISTS "payout_account_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_movements_account_fk') THEN
    ALTER TABLE "floraclin"."cash_movements" ADD CONSTRAINT "cash_movements_account_fk"
      FOREIGN KEY ("tenant_id", "account_id") REFERENCES "floraclin"."financial_accounts"("tenant_id", "id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'card_terminals_payout_account_fk') THEN
    ALTER TABLE "floraclin"."card_terminals" ADD CONSTRAINT "card_terminals_payout_account_fk"
      FOREIGN KEY ("tenant_id", "payout_account_id") REFERENCES "floraclin"."financial_accounts"("tenant_id", "id");
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cash_movements_account_date" ON "floraclin"."cash_movements" ("tenant_id", "account_id", "movement_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cash_movements_transfer_group" ON "floraclin"."cash_movements" ("transfer_group_id") WHERE "transfer_group_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "floraclin"."financial_accounts" ("tenant_id", "kind", "name")
SELECT DISTINCT cm."tenant_id", 'legacy', 'Geral (antes das contas)'
FROM "floraclin"."cash_movements" cm
WHERE cm."account_id" IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "floraclin"."cash_movements" cm
SET "account_id" = fa."id"
FROM "floraclin"."financial_accounts" fa
WHERE cm."account_id" IS NULL
  AND fa."tenant_id" = cm."tenant_id"
  AND fa."kind" = 'legacy';
