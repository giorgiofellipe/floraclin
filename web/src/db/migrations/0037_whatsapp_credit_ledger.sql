CREATE TABLE IF NOT EXISTS "floraclin"."whatsapp_credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"credit_period_id" uuid NOT NULL,
	"kind" varchar(10) NOT NULL,
	"amount" integer NOT NULL,
	"meta_message_id" varchar(255),
	"refund_of" uuid,
	"refund_reason" varchar(20),
	"actor_type" varchar(10) NOT NULL,
	"actor_user_id" uuid,
	"patient_id" uuid,
	"conversation_id" uuid,
	"contact_name" varchar(255),
	"contact_phone" varchar(30) NOT NULL,
	"item_kind" varchar(10) NOT NULL,
	"template_name" varchar(255),
	"purpose_key" varchar(100),
	"document_label" varchar(255),
	"created_at" timestamptz(3) DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_credit_ledger" ADD CONSTRAINT "whatsapp_credit_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_credit_ledger" ADD CONSTRAINT "whatsapp_credit_ledger_credit_period_id_whatsapp_credits_id_fk" FOREIGN KEY ("credit_period_id") REFERENCES "floraclin"."whatsapp_credits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_credit_ledger" ADD CONSTRAINT "whatsapp_credit_ledger_refund_of_whatsapp_credit_ledger_id_fk" FOREIGN KEY ("refund_of") REFERENCES "floraclin"."whatsapp_credit_ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_credit_ledger" ADD CONSTRAINT "whatsapp_credit_ledger_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_credit_ledger" ADD CONSTRAINT "whatsapp_credit_ledger_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "floraclin"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_credit_ledger" ADD CONSTRAINT "whatsapp_credit_ledger_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "floraclin"."whatsapp_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_whatsapp_credit_ledger_period" ON "floraclin"."whatsapp_credit_ledger" USING btree ("tenant_id","credit_period_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_whatsapp_credit_ledger_refund_of" ON "floraclin"."whatsapp_credit_ledger" USING btree ("refund_of") WHERE refund_of IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_whatsapp_credit_ledger_spend_meta" ON "floraclin"."whatsapp_credit_ledger" USING btree ("meta_message_id") WHERE meta_message_id IS NOT NULL AND kind = 'spend';--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_credit_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_queued_messages" ADD COLUMN IF NOT EXISTS "credit_context" jsonb;--> statement-breakpoint
INSERT INTO "floraclin"."whatsapp_credit_ledger"
	("id","tenant_id","credit_period_id","kind","amount","meta_message_id","actor_type","patient_id","conversation_id","contact_name","contact_phone","item_kind","template_name","purpose_key","created_at")
SELECT c.id, c.tenant_id, c.credit_period_id, 'spend', -c.cost, c.meta_message_id, 'system',
	conv.patient_id, conv.id, conv.profile_name, COALESCE(conv.phone_number, 'desconhecido'),
	CASE WHEN m.template_name IS NOT NULL THEN 'template' WHEN m.media_type IS NOT NULL THEN 'media' ELSE 'text' END,
	m.template_name, t.purpose_key, c.created_at
FROM "floraclin"."whatsapp_credit_charges" c
LEFT JOIN "floraclin"."whatsapp_messages" m ON m.meta_message_id = c.meta_message_id AND m.tenant_id = c.tenant_id
LEFT JOIN "floraclin"."whatsapp_conversations" conv ON conv.id = m.conversation_id
LEFT JOIN LATERAL (
	SELECT purpose_key FROM "floraclin"."whatsapp_templates" wt
	WHERE wt.name = m.template_name AND (wt.tenant_id = c.tenant_id OR wt.system_template)
	LIMIT 1
) t ON true
WHERE NOT EXISTS (SELECT 1 FROM "floraclin"."whatsapp_credit_ledger" x WHERE x.id = c.id);--> statement-breakpoint
INSERT INTO "floraclin"."whatsapp_credit_ledger"
	("tenant_id","credit_period_id","kind","amount","refund_of","refund_reason","actor_type","patient_id","conversation_id","contact_name","contact_phone","item_kind","template_name","purpose_key","created_at")
SELECT l.tenant_id, l.credit_period_id, 'refund', -l.amount, l.id, 'delivery_failed', 'system',
	l.patient_id, l.conversation_id, l.contact_name, l.contact_phone, l.item_kind, l.template_name, l.purpose_key, c.refunded_at
FROM "floraclin"."whatsapp_credit_charges" c
JOIN "floraclin"."whatsapp_credit_ledger" l ON l.id = c.id
WHERE c.refunded_at IS NOT NULL
	AND NOT EXISTS (SELECT 1 FROM "floraclin"."whatsapp_credit_ledger" r WHERE r.refund_of = l.id);

