-- The four applied_* columns stay nullable here because the old code still
-- inserts installments without them while this deploys. The trigger at the end
-- fills them on insert. A later migration sets them NOT NULL and drops the
-- trigger.
ALTER TABLE "floraclin"."installments" ADD COLUMN IF NOT EXISTS "applied_grace_period_days" integer;
--> statement-breakpoint
ALTER TABLE "floraclin"."installments" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "floraclin"."installments" ADD COLUMN IF NOT EXISTS "penalty_pauses" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "floraclin"."financial_entries" ADD COLUMN IF NOT EXISTS "created_from_renegotiation" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Defaults match loadInstallmentTerms for a tenant without a settings row.
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
-- The latest bulk cancel or renegotiation logged on the entry, else the
-- entry's updated_at (procedure cancels log on the procedure, not the entry).
UPDATE "floraclin"."installments" i
SET "cancelled_at" = COALESCE(
	(
		SELECT max(al."created_at")
		FROM "floraclin"."audit_logs" al
		WHERE al."tenant_id" = i."tenant_id"
			AND al."entity_type" = 'financial_entry'
			AND al."action" = 'update'
			AND al."entity_id" = i."financial_entry_id"
			AND al."changes"->'status'->>'new' IN ('cancelled', 'renegotiated')
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
--> statement-breakpoint
CREATE FUNCTION "floraclin"."installments_fill_terms"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
	fs "floraclin"."financial_settings"%ROWTYPE;
BEGIN
	IF NEW."applied_fine_type" IS NULL OR NEW."applied_fine_value" IS NULL
		OR NEW."applied_interest_rate" IS NULL OR NEW."applied_grace_period_days" IS NULL THEN
		SELECT * INTO fs FROM "floraclin"."financial_settings" WHERE "tenant_id" = NEW."tenant_id";
		NEW."applied_fine_type" := COALESCE(NEW."applied_fine_type", fs."fine_type", 'percentage');
		NEW."applied_fine_value" := COALESCE(NEW."applied_fine_value", fs."fine_value", 2.00);
		NEW."applied_interest_rate" := COALESCE(NEW."applied_interest_rate", fs."monthly_interest_percent", 1.00);
		NEW."applied_grace_period_days" := COALESCE(NEW."applied_grace_period_days", fs."grace_period_days", 0);
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "installments_fill_terms"
	BEFORE INSERT ON "floraclin"."installments"
	FOR EACH ROW EXECUTE FUNCTION "floraclin"."installments_fill_terms"();
