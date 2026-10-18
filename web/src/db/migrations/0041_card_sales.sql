CREATE TABLE IF NOT EXISTS "floraclin"."card_terminals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"debit_rate" numeric(5, 2) NOT NULL,
	"debit_payout_days" integer DEFAULT 1 NOT NULL,
	"credit_rates" jsonb NOT NULL,
	"credit_payout_mode" varchar(20) NOT NULL,
	"credit_lump_sum_days" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "card_terminals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id"),
	CONSTRAINT "card_terminals_credit_payout_mode_check" CHECK ("credit_payout_mode" IN ('per_installment','lump_sum')),
	CONSTRAINT "card_terminals_credit_rates_check" CHECK (jsonb_array_length("credit_rates") = 12)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_card_terminals_default" ON "floraclin"."card_terminals" USING btree ("tenant_id") WHERE is_default AND deleted_at IS NULL;--> statement-breakpoint
ALTER TABLE "floraclin"."card_terminals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floraclin"."card_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"card_terminal_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"method" varchar(20) NOT NULL,
	"installment_count" integer NOT NULL,
	"rate" numeric(5, 2) NOT NULL,
	"payout_mode" varchar(20) NOT NULL,
	"gross_amount" numeric(10, 2) NOT NULL,
	"fee_amount" numeric(10, 2) NOT NULL,
	"net_amount" numeric(10, 2) NOT NULL,
	"description" varchar(255) NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id"),
	CONSTRAINT "card_payments_card_terminal_id_fk" FOREIGN KEY ("card_terminal_id") REFERENCES "floraclin"."card_terminals"("id"),
	CONSTRAINT "card_payments_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "floraclin"."patients"("id"),
	CONSTRAINT "card_payments_reversed_by_fk" FOREIGN KEY ("reversed_by") REFERENCES "floraclin"."users"("id"),
	CONSTRAINT "card_payments_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "floraclin"."users"("id"),
	CONSTRAINT "card_payments_method_check" CHECK ("method" IN ('credit_card','debit_card')),
	CONSTRAINT "card_payments_payout_mode_check" CHECK ("payout_mode" IN ('per_installment','lump_sum','debit')),
	CONSTRAINT "card_payments_installment_count_check" CHECK ("installment_count" BETWEEN 1 AND 12)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_card_payments_tenant_paid" ON "floraclin"."card_payments" USING btree ("tenant_id","paid_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_card_payments_patient" ON "floraclin"."card_payments" USING btree ("tenant_id","patient_id");--> statement-breakpoint
ALTER TABLE "floraclin"."card_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floraclin"."card_repasses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"card_payment_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"expected_date" date NOT NULL,
	"gross_amount" numeric(10, 2) NOT NULL,
	"fee_amount" numeric(10, 2) NOT NULL,
	"net_amount" numeric(10, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"received_at" timestamp with time zone,
	"cash_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_repasses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id"),
	CONSTRAINT "card_repasses_card_payment_id_fk" FOREIGN KEY ("card_payment_id") REFERENCES "floraclin"."card_payments"("id"),
	CONSTRAINT "card_repasses_cash_movement_id_fk" FOREIGN KEY ("cash_movement_id") REFERENCES "floraclin"."cash_movements"("id"),
	CONSTRAINT "card_repasses_status_check" CHECK ("status" IN ('pending','received','cancelled')),
	CONSTRAINT "card_repasses_received_movement_check" CHECK (("status" = 'received') = ("cash_movement_id" IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_card_repasses_status_date" ON "floraclin"."card_repasses" USING btree ("tenant_id","status","expected_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_card_repasses_payment_sequence" ON "floraclin"."card_repasses" USING btree ("card_payment_id","sequence");--> statement-breakpoint
ALTER TABLE "floraclin"."card_repasses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "floraclin"."financial_entries" ADD COLUMN IF NOT EXISTS "payment_method" varchar(20);--> statement-breakpoint
ALTER TABLE "floraclin"."financial_entries" ADD COLUMN IF NOT EXISTS "card_installment_count" integer;--> statement-breakpoint
ALTER TABLE "floraclin"."financial_entries" ADD CONSTRAINT "financial_entries_payment_method_check" CHECK ("payment_method" IS NULL OR "payment_method" IN ('pix','credit_card','debit_card','cash','transfer'));--> statement-breakpoint
ALTER TABLE "floraclin"."financial_entries" ADD CONSTRAINT "financial_entries_card_installment_count_check" CHECK ("card_installment_count" IS NULL OR "card_installment_count" BETWEEN 1 AND 12);--> statement-breakpoint
ALTER TABLE "floraclin"."payment_records" ADD COLUMN IF NOT EXISTS "card_payment_id" uuid;--> statement-breakpoint
ALTER TABLE "floraclin"."payment_records" ADD CONSTRAINT "payment_records_card_payment_id_fk" FOREIGN KEY ("card_payment_id") REFERENCES "floraclin"."card_payments"("id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payment_records_card_payment" ON "floraclin"."payment_records" USING btree ("card_payment_id");--> statement-breakpoint
ALTER TABLE "floraclin"."cash_movements" ADD COLUMN IF NOT EXISTS "card_repasse_id" uuid;--> statement-breakpoint
ALTER TABLE "floraclin"."cash_movements" ADD CONSTRAINT "cash_movements_card_repasse_id_fk" FOREIGN KEY ("card_repasse_id") REFERENCES "floraclin"."card_repasses"("id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_cash_movements_active_repasse_inflow" ON "floraclin"."cash_movements" USING btree ("card_repasse_id") WHERE type = 'inflow' AND reversed_by_movement_id IS NULL AND card_repasse_id IS NOT NULL;
