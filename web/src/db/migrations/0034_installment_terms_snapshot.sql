-- The four applied_* columns are backfilled and set NOT NULL here. The old
-- code still inserts installments without them while this deploys, so the
-- BEFORE INSERT trigger, created before the backfill, fills them (it runs
-- before the NOT NULL check). A follow-up migration drops the trigger, its
-- function and the obsolete fine_amount, interest_amount and
-- last_fine_interest_calc_at.
ALTER TABLE "floraclin"."installments" ADD COLUMN IF NOT EXISTS "applied_grace_period_days" integer;
--> statement-breakpoint
ALTER TABLE "floraclin"."installments" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "floraclin"."installments" ADD COLUMN IF NOT EXISTS "penalty_pauses" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "floraclin"."financial_entries" ADD COLUMN IF NOT EXISTS "created_from_renegotiation" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "floraclin"."installments_fill_terms"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
	fs "floraclin"."financial_settings"%ROWTYPE;
BEGIN
	IF NEW."applied_fine_type" IS NULL OR NEW."applied_fine_value" IS NULL
		OR NEW."applied_interest_rate" IS NULL OR NEW."applied_grace_period_days" IS NULL THEN
		SELECT * INTO fs FROM "floraclin"."financial_settings" WHERE "tenant_id" = NEW."tenant_id";
		-- Defaults: DEFAULT_INSTALLMENT_TERMS in web/src/db/queries/financial.ts.
		NEW."applied_fine_type" := COALESCE(NEW."applied_fine_type", fs."fine_type", 'percentage');
		NEW."applied_fine_value" := COALESCE(NEW."applied_fine_value", fs."fine_value", 2.00);
		NEW."applied_interest_rate" := COALESCE(NEW."applied_interest_rate", fs."monthly_interest_percent", 1.00);
		NEW."applied_grace_period_days" := COALESCE(NEW."applied_grace_period_days", fs."grace_period_days", 0);
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "installments_fill_terms" ON "floraclin"."installments";
--> statement-breakpoint
CREATE TRIGGER "installments_fill_terms"
	BEFORE INSERT ON "floraclin"."installments"
	FOR EACH ROW EXECUTE FUNCTION "floraclin"."installments_fill_terms"();
--> statement-breakpoint
-- Defaults: DEFAULT_INSTALLMENT_TERMS in web/src/db/queries/financial.ts.
UPDATE "floraclin"."installments" i
SET
	"applied_fine_type" = COALESCE(i."applied_fine_type", (SELECT fs."fine_type" FROM "floraclin"."financial_settings" fs WHERE fs."tenant_id" = i."tenant_id"), 'percentage'),
	"applied_fine_value" = COALESCE(i."applied_fine_value", (SELECT fs."fine_value" FROM "floraclin"."financial_settings" fs WHERE fs."tenant_id" = i."tenant_id"), 2.00),
	"applied_interest_rate" = COALESCE(i."applied_interest_rate", (SELECT fs."monthly_interest_percent" FROM "floraclin"."financial_settings" fs WHERE fs."tenant_id" = i."tenant_id"), 1.00),
	"applied_grace_period_days" = COALESCE(i."applied_grace_period_days", (SELECT fs."grace_period_days" FROM "floraclin"."financial_settings" fs WHERE fs."tenant_id" = i."tenant_id"), 0)
WHERE i."applied_fine_type" IS NULL
	OR i."applied_fine_value" IS NULL
	OR i."applied_interest_rate" IS NULL
	OR i."applied_grace_period_days" IS NULL;
--> statement-breakpoint
ALTER TABLE "floraclin"."installments" ALTER COLUMN "applied_fine_type" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "floraclin"."installments" ALTER COLUMN "applied_fine_value" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "floraclin"."installments" ALTER COLUMN "applied_interest_rate" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "floraclin"."installments" ALTER COLUMN "applied_grace_period_days" SET NOT NULL;
--> statement-breakpoint
-- Legacy cancels also cancelled installments whose principal was already paid.
UPDATE "floraclin"."installments" i
SET
	"status" = 'paid',
	"cancelled_at" = NULL,
	"paid_at" = COALESCE(latest."paid_at", i."paid_at"),
	"payment_method" = COALESCE(latest."payment_method", i."payment_method")
FROM "floraclin"."installments" target
LEFT JOIN LATERAL (
	SELECT pr."paid_at", pr."payment_method"
	FROM "floraclin"."payment_records" pr
	WHERE pr."installment_id" = target."id"
		AND pr."reversed_at" IS NULL
	ORDER BY pr."paid_at" DESC, pr."recorded_at" DESC
	LIMIT 1
) latest ON true
WHERE target."id" = i."id"
	AND i."status" = 'cancelled'
	AND i."amount_paid" >= i."amount";
--> statement-breakpoint
-- The first cancel or renegotiation logged on the entry since it was last
-- reactivated, else the entry's updated_at (procedure cancels log on the
-- procedure, not the entry).
UPDATE "floraclin"."installments" i
SET "cancelled_at" = COALESCE(
	(
		SELECT min(al."created_at")
		FROM "floraclin"."audit_logs" al
		WHERE al."tenant_id" = i."tenant_id"
			AND al."entity_type" = 'financial_entry'
			AND al."action" = 'update'
			AND al."entity_id" = i."financial_entry_id"
			AND al."changes"->'status'->>'new' IN ('cancelled', 'renegotiated')
			AND al."created_at" > COALESCE(
				(
					SELECT max(act."created_at")
					FROM "floraclin"."audit_logs" act
					WHERE act."tenant_id" = i."tenant_id"
						AND act."entity_type" = 'financial_entry'
						AND act."action" = 'update'
						AND act."entity_id" = i."financial_entry_id"
						AND act."changes"->'status'->>'old' IN ('cancelled', 'renegotiated')
						AND act."changes"->'status'->>'new' NOT IN ('cancelled', 'renegotiated')
				),
				'-infinity'::timestamptz
			)
	),
	fe."updated_at"
)
FROM "floraclin"."financial_entries" fe
WHERE fe."id" = i."financial_entry_id"
	AND i."status" = 'cancelled'
	AND i."cancelled_at" IS NULL;
--> statement-breakpoint
UPDATE "floraclin"."financial_entries" fe
SET "created_from_renegotiation" = true
WHERE fe."created_from_renegotiation" = false
	AND (
		fe."id" IN (SELECT rl."new_entry_id" FROM "floraclin"."renegotiation_links" rl)
		OR EXISTS (
			SELECT 1
			FROM "floraclin"."audit_logs" al
			WHERE al."tenant_id" = fe."tenant_id"
				AND al."entity_type" = 'financial_entry'
				AND al."action" = 'create'
				AND al."entity_id" = fe."id"
				AND al."changes"->'type'->>'new' = 'renegotiation'
		)
	);
