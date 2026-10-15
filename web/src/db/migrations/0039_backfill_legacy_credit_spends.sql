-- Before #75 no spend was recorded per send. Rebuild those spends from the old rule: 1 credit per template send,
-- free when the phone already had an outbound message in the previous 24h. #75 was merged at 2026-10-14 19:12 UTC.
INSERT INTO "floraclin"."whatsapp_credit_ledger"
	("tenant_id","credit_period_id","kind","amount","meta_message_id","actor_type","patient_id","conversation_id","contact_name","contact_phone","item_kind","template_name","purpose_key","created_at")
SELECT m.tenant_id, p.id, 'spend', -1, m.meta_message_id, 'system',
	conv.patient_id, conv.id, conv.profile_name, conv.phone_number,
	'template', m.template_name, t.purpose_key, m.created_at
FROM "floraclin"."whatsapp_messages" m
JOIN "floraclin"."whatsapp_conversations" conv ON conv.id = m.conversation_id AND conv.tenant_id = m.tenant_id
JOIN "floraclin"."whatsapp_credits" p ON p.tenant_id = m.tenant_id
	AND m.created_at >= p.period_start AND m.created_at < p.period_end AND p.credits_used > 0
LEFT JOIN LATERAL (
	SELECT purpose_key FROM "floraclin"."whatsapp_templates" wt
	WHERE wt.name = m.template_name AND (wt.tenant_id = m.tenant_id OR wt.system_template)
	ORDER BY wt.purpose_key IS NULL, wt.system_template
	LIMIT 1
) t ON true
WHERE m.direction = 'outbound'
	AND m.template_name IS NOT NULL
	AND m.created_at < '2026-10-14 19:12:24+00'
	AND NOT EXISTS (
		SELECT 1 FROM "floraclin"."whatsapp_messages" prev
		JOIN "floraclin"."whatsapp_conversations" pc ON pc.id = prev.conversation_id
		WHERE pc.tenant_id = m.tenant_id AND pc.phone_number = conv.phone_number
			AND prev.direction = 'outbound'
			AND prev.created_at < m.created_at AND prev.created_at > m.created_at - interval '24 hours'
	)
	AND NOT EXISTS (
		SELECT 1 FROM "floraclin"."whatsapp_credit_ledger" x
		WHERE x.tenant_id = m.tenant_id AND x.meta_message_id = m.meta_message_id AND x.kind = 'spend'
	);
