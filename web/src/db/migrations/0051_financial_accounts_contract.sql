-- Finance accounts, part 2 of 2 (contract). Apply by hand only AFTER the deploy that writes
-- cash_movements.account_id on every movement is live and old instances have drained (at least one hour).
-- Re-runs 0050's backfill for rows old code wrote in between, refuses to continue while any row is still
-- unattributed, then enforces account_id NOT NULL. Idempotent.
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
  AND fa."kind" = 'legacy';--> statement-breakpoint
DO $$
DECLARE unattributed bigint;
BEGIN
  SELECT count(*) INTO unattributed FROM "floraclin"."cash_movements" WHERE "account_id" IS NULL;
  IF unattributed > 0 THEN
    RAISE EXCEPTION 'cash_movements still has % rows without account_id', unattributed;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "floraclin"."cash_movements" ALTER COLUMN "account_id" SET NOT NULL;
