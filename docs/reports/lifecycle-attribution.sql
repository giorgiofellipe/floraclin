-- Lifecycle message funnel per message and channel.
-- Each activation is credited to the tenant's last click in the 7 days before it.
with facts as (
  select t.id as tenant_id, f.kind, f.at
  from floraclin.tenants t
  cross join lateral (values
    ('first_patient', (select min(p.created_at) from floraclin.patients p where p.tenant_id = t.id)),
    ('first_appointment', (select min(a.created_at) from floraclin.appointments a where a.tenant_id = t.id)),
    ('automation_enabled', (select min(w.first_enabled_at) from floraclin.whatsapp_automations w where w.tenant_id = t.id)),
    ('paid', (select s.first_paid_at from floraclin.tenant_subscriptions s where s.tenant_id = t.id))
  ) as f(kind, at)
  where f.at is not null
),
credited as (
  select last_click.lifecycle_message_id,
    count(*) filter (where f.kind = 'first_patient') as first_patient,
    count(*) filter (where f.kind = 'first_appointment') as first_appointment,
    count(*) filter (where f.kind = 'automation_enabled') as automation_enabled,
    count(*) filter (where f.kind = 'paid') as paid
  from facts f
  cross join lateral (
    select c.lifecycle_message_id
    from floraclin.tenant_lifecycle_clicks c
    where c.tenant_id = f.tenant_id
      and c.created_at <= f.at
      and c.created_at > f.at - interval '7 days'
    order by c.created_at desc
    limit 1
  ) last_click
  group by last_click.lifecycle_message_id
)
select
  m.message_key,
  m.channel,
  count(*) filter (where m.meta_message_id is not null or m.provider_message_id is not null) as sent,
  count(*) filter (where m.delivered_at is not null) as delivered,
  count(*) filter (where m.read_at is not null) as read,
  count(*) filter (where m.status = 'failed') as failed,
  count(*) filter (where exists (select 1 from floraclin.tenant_lifecycle_clicks c where c.lifecycle_message_id = m.id)) as clicked,
  coalesce(sum(cr.first_patient), 0) as first_patient,
  coalesce(sum(cr.first_appointment), 0) as first_appointment,
  coalesce(sum(cr.automation_enabled), 0) as automation_enabled,
  coalesce(sum(cr.paid), 0) as paid
from floraclin.tenant_lifecycle_messages m
left join credited cr on cr.lifecycle_message_id = m.id
group by m.message_key, m.channel
order by m.message_key, m.channel;
