-- Repeats the copy from 0037 on purpose: it picks up charges the old code wrote before the deploy went live.
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
	ORDER BY wt.system_template
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
	AND NOT EXISTS (SELECT 1 FROM "floraclin"."whatsapp_credit_ledger" r WHERE r.refund_of = l.id);--> statement-breakpoint
DROP TABLE IF EXISTS "floraclin"."whatsapp_credit_charges";
