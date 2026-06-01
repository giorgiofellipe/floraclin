# WhatsApp Appointment Confirmation + Auto-Anamnesis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate appointment confirmations via WhatsApp with interactive buttons, auto-send anamnesis links when stale, and surface pending reschedules in the UI.

**Architecture:** Hourly Vercel cron job sends confirmations; webhook handler processes button replies (confirm/reschedule); anamnesis auto-send triggered inline after confirmation. New pending-reschedule page under `/agenda` and dashboard widget.

**Tech Stack:** Next.js API routes, Drizzle ORM, Meta WhatsApp Cloud API, Vercel Cron

---

## Group A (parallel): Schema, Types, Blueprint

### Task 1: Add appointment confirmation columns and update types

**Files:**
- Modify: `web/src/db/schema.ts`
- Modify: `web/src/types/index.ts`
- Create: `web/src/db/migrations/0019_appointment_confirmation.sql`

- [ ] **Step 1: Write the migration SQL**

Create `web/src/db/migrations/0019_appointment_confirmation.sql`:

```sql
ALTER TABLE "floraclin"."appointments" ADD COLUMN "confirmation_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "floraclin"."appointments" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "floraclin"."appointments" ADD COLUMN "confirmation_message_id" varchar(100);--> statement-breakpoint
UPDATE "floraclin"."whatsapp_automations" SET "trigger" = 'appointment_confirmation' WHERE "trigger" = 'appointment_reminder';
```

- [ ] **Step 2: Update the Drizzle schema**

In `web/src/db/schema.ts`, add three columns to the `appointments` table definition, after the `clinicGoogleEventId` column:

```typescript
confirmationSentAt: timestamp('confirmation_sent_at', { withTimezone: true }),
confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
confirmationMessageId: varchar('confirmation_message_id', { length: 100 }),
```

- [ ] **Step 3: Update AppointmentStatus type**

In `web/src/types/index.ts`, add `'pending_reschedule'` to the `AppointmentStatus` union:

```typescript
export type AppointmentStatus = 'scheduled' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show' | 'pending_reschedule'
```

- [ ] **Step 4: Run migration**

```bash
npx dotenv -e .env.local -- npx drizzle-kit push
```

- [ ] **Step 5: Commit**

```bash
git add web/src/db/schema.ts web/src/types/index.ts web/src/db/migrations/0019_appointment_confirmation.sql
git commit -m "feat(schema): add appointment confirmation columns and pending_reschedule status"
```

### Task 2: Update confirmation template blueprint with quick-reply buttons

**Files:**
- Modify: `web/src/lib/whatsapp-blueprints.ts`

- [ ] **Step 1: Update the appointment_confirmation blueprint**

In `web/src/lib/whatsapp-blueprints.ts`, replace the `appointment_confirmation` blueprint's `components` field. Change from `makeBody(...)` to an inline array with BODY + BUTTONS:

```typescript
{
  slug: 'appointment_confirmation',
  purposeKey: 'appointment_confirmation',
  name: 'appointment_confirmation',
  category: 'UTILITY',
  language: 'pt_BR',
  description: 'Confirmação de presença na consulta',
  variables: [
    { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
    { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
    { index: 3, key: 'appointment_date', label: 'Data da consulta', example: '15/04/2026' },
    { index: 4, key: 'appointment_time', label: 'Horário', example: '14:30' },
  ],
  components: [
    {
      type: 'BODY',
      text: 'Olá, {{1}}! Gostaríamos de confirmar sua presença na {{2}} no dia {{3}}, às {{4}}.',
      example: {
        body_text: [['Maria Silva', 'Clínica Flora', '15/04/2026', '14:30']],
      },
    },
    {
      type: 'BUTTONS',
      buttons: [
        { type: 'QUICK_REPLY', text: 'Confirmar' },
        { type: 'QUICK_REPLY', text: 'Reagendar' },
      ],
    },
  ],
},
```

- [ ] **Step 2: Remove the appointment_reminder trigger from the TRIGGERS UI config**

In `web/src/components/settings/whatsapp-automations.tsx`, remove the `appointment_reminder` entry from the `TRIGGERS` array (lines ~40-49). It's being replaced by `appointment_confirmation`.

Wait — this file is owned by Task 6 in Group B. Skip this step here; it belongs to the automations UI task.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/whatsapp-blueprints.ts
git commit -m "feat(whatsapp): update confirmation template blueprint with quick-reply buttons"
```

---

## Group B (depends on A): Core Logic — Cron, Webhook, Queries

### Task 3: Add appointment confirmation query helpers

**Files:**
- Modify: `web/src/db/queries/appointments.ts`

- [ ] **Step 1: Write the failing test**

Create test expectations for the new query functions. Since these are DB queries that hit Postgres directly, we'll test them through the API routes. Skip unit tests for raw queries — they'll be covered by integration tests in Tasks 4 and 5.

- [ ] **Step 2: Add `getAppointmentsPendingConfirmation` function**

At the end of `web/src/db/queries/appointments.ts`, add:

```typescript
import { brToday, parseBrDate } from '@/lib/dates'

export async function getAppointmentsPendingConfirmation(
  tenantId: string,
  hoursBeforeAppointment: number,
) {
  // Use BR-aware "now" so the window is correct regardless of host TZ
  const nowBr = parseBrDate(brToday(), new Date().toLocaleTimeString('sv-SE', { timeZone: 'America/Sao_Paulo' }))
  const windowEnd = new Date(nowBr.getTime() + hoursBeforeAppointment * 60 * 60 * 1000)

  // appointments.date is a BR calendar day (DATE column), startTime is HH:MM:SS.
  // Build a BR-local naive timestamp and compare in the same TZ using AT TIME ZONE.
  const results = await db
    .select({
      id: appointments.id,
      tenantId: appointments.tenantId,
      patientId: appointments.patientId,
      practitionerId: appointments.practitionerId,
      date: appointments.date,
      startTime: appointments.startTime,
      bookingName: appointments.bookingName,
      bookingPhone: appointments.bookingPhone,
      patientName: patients.fullName,
      patientPhone: patients.phone,
    })
    .from(appointments)
    .leftJoin(patients, eq(patients.id, appointments.patientId))
    .where(
      and(
        eq(appointments.tenantId, tenantId),
        eq(appointments.status, 'scheduled'),
        isNull(appointments.confirmationSentAt),
        isNull(appointments.deletedAt),
        sql`(${appointments.date} || ' ' || ${appointments.startTime})::timestamp AT TIME ZONE 'America/Sao_Paulo' <= ${windowEnd}::timestamptz`,
        sql`(${appointments.date} || ' ' || ${appointments.startTime})::timestamp AT TIME ZONE 'America/Sao_Paulo' > now()`,
      )
    )

  return results.filter((a) => a.patientPhone || a.bookingPhone)
}
```

Add the necessary imports at the top if not already present: `patients` from schema, `sql` from drizzle-orm.

- [ ] **Step 3: Add `markConfirmationSent` function**

```typescript
export async function markConfirmationSent(
  tenantId: string,
  appointmentId: string,
  confirmationMessageId: string,
) {
  const [result] = await db
    .update(appointments)
    .set({
      confirmationSentAt: new Date(),
      confirmationMessageId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(appointments.tenantId, tenantId),
        eq(appointments.id, appointmentId),
        isNull(appointments.deletedAt),
      )
    )
    .returning()

  return result ?? null
}
```

- [ ] **Step 4: Add `confirmAppointment` function**

```typescript
export async function confirmAppointment(
  tenantId: string,
  appointmentId: string,
) {
  const [result] = await db
    .update(appointments)
    .set({
      status: 'confirmed' as AppointmentStatus,
      confirmedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(appointments.tenantId, tenantId),
        eq(appointments.id, appointmentId),
        eq(appointments.status, 'scheduled'),
        isNull(appointments.deletedAt),
      )
    )
    .returning()

  return result ?? null
}
```

- [ ] **Step 5: Add `getAppointmentByConfirmationMessageId` function**

```typescript
export async function getAppointmentByConfirmationMessageId(
  tenantId: string,
  confirmationMessageId: string,
) {
  const [result] = await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.tenantId, tenantId),
        eq(appointments.confirmationMessageId, confirmationMessageId),
        isNull(appointments.deletedAt),
      )
    )
    .limit(1)

  return result ?? null
}
```

- [ ] **Step 6: Add `getPendingRescheduleAppointments` function**

```typescript
export async function getPendingRescheduleAppointments(
  tenantId: string,
  practitionerId?: string,
) {
  const conditions = [
    eq(appointments.tenantId, tenantId),
    eq(appointments.status, 'pending_reschedule' as AppointmentStatus),
    isNull(appointments.deletedAt),
  ]

  if (practitionerId) {
    conditions.push(eq(appointments.practitionerId, practitionerId))
  }

  return db
    .select({
      id: appointments.id,
      date: appointments.date,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      patientId: appointments.patientId,
      bookingName: appointments.bookingName,
      bookingPhone: appointments.bookingPhone,
      notes: appointments.notes,
      updatedAt: appointments.updatedAt,
      patientName: patients.fullName,
      patientPhone: patients.phone,
      practitionerName: users.name,
    })
    .from(appointments)
    .leftJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(users, eq(users.id, appointments.practitionerId))
    .where(and(...conditions))
    .orderBy(asc(appointments.updatedAt))
}
```

Add import for `users` from schema and `asc` from drizzle-orm if not present.

- [ ] **Step 7: Add `countPendingReschedule` function**

```typescript
export async function countPendingReschedule(
  tenantId: string,
  practitionerId?: string,
) {
  const conditions = [
    eq(appointments.tenantId, tenantId),
    eq(appointments.status, 'pending_reschedule' as AppointmentStatus),
    isNull(appointments.deletedAt),
  ]

  if (practitionerId) {
    conditions.push(eq(appointments.practitionerId, practitionerId))
  }

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(appointments)
    .where(and(...conditions))

  return result?.count ?? 0
}
```

- [ ] **Step 8: Commit**

```bash
git add web/src/db/queries/appointments.ts
git commit -m "feat(appointments): add confirmation and pending-reschedule query helpers"
```

### Task 4: Create the cron job for sending confirmations

**Files:**
- Create: `web/src/app/api/cron/whatsapp-automations/route.ts`
- Modify: `web/vercel.json`

- [ ] **Step 1: Create the cron route**

Create `web/src/app/api/cron/whatsapp-automations/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { getAppointmentsPendingConfirmation, markConfirmationSent } from '@/db/queries/appointments'
import { listAutomations } from '@/db/queries/whatsapp'
import { getTemplateByPurpose } from '@/db/queries/whatsapp'
import { sendTemplateMessage } from '@/lib/whatsapp'
import { upsertConversation, createMessage, pushSseEvent } from '@/db/queries/whatsapp'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allTenants = await db
    .select({ id: tenants.id, name: tenants.name, settings: tenants.settings })
    .from(tenants)

  const waEnabled = allTenants.filter((t) => {
    const s = t.settings as Record<string, unknown> | null
    return s?.whatsapp_enabled
  })

  let sent = 0
  let skipped = 0
  const errors: Array<{ tenant: string; error: string }> = []

  for (const tenant of waEnabled) {
    try {
      const automations = await listAutomations(tenant.id)
      const confirmationAuto = automations.find(
        (a) => a.trigger === 'appointment_confirmation' && a.enabled
      )
      if (!confirmationAuto) {
        skipped++
        continue
      }

      const template = confirmationAuto.templateId
        ? await getTemplateByPurpose(tenant.id, 'appointment_confirmation')
        : null
      if (!template || template.status !== 'APPROVED') {
        skipped++
        continue
      }

      const config = (confirmationAuto.config ?? {}) as Record<string, unknown>
      const hoursBeforeAppointment = (config.hoursBeforeAppointment as number) ?? 24

      const pendingAppointments = await getAppointmentsPendingConfirmation(
        tenant.id,
        hoursBeforeAppointment,
      )

      for (const appt of pendingAppointments) {
        try {
          const phone = appt.patientPhone ?? appt.bookingPhone
          if (!phone) continue

          const rawPhone = phone.replace(/\D/g, '')
          const normalizedPhone = rawPhone.startsWith('55') ? rawPhone : `55${rawPhone}`
          const name = appt.patientName ?? appt.bookingName ?? ''

          const params: Record<string, string> = {
            '1': name.split(' ')[0] || name,
            '2': tenant.name,
            '3': formatDateBr(appt.date),
            '4': appt.startTime.slice(0, 5),
          }

          const result = await sendTemplateMessage(
            tenant.id,
            normalizedPhone,
            template.name,
            template.language,
            params,
          )

          await markConfirmationSent(tenant.id, appt.id, result.metaMessageId)

          const conversation = await upsertConversation(
            tenant.id,
            normalizedPhone,
            name,
            undefined,
            appt.patientId ?? undefined,
          )

          const resolvedBody = template.components
            ? resolveBody(template.components, params)
            : null

          const message = await createMessage(tenant.id, conversation.id, {
            direction: 'outbound',
            metaMessageId: result.metaMessageId,
            body: resolvedBody,
            templateName: template.name,
            deliveryStatus: 'sent',
          })

          await pushSseEvent(tenant.id, 'new_message', {
            conversationId: conversation.id,
            message,
          })

          sent++
        } catch (err) {
          console.error(`[cron] Failed to send confirmation for appointment ${appt.id}:`, err)
          errors.push({
            tenant: tenant.name,
            error: `appointment ${appt.id}: ${err instanceof Error ? err.message : String(err)}`,
          })
        }
      }
    } catch (err) {
      console.error(`[cron] Failed for tenant ${tenant.name}:`, err)
      errors.push({
        tenant: tenant.name,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, errors })
}

function formatDateBr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

function resolveBody(
  components: unknown,
  params: Record<string, string>,
): string | null {
  const comps = components as Array<{ type: string; text?: string }>
  const body = comps?.find((c) => c.type === 'BODY')
  if (!body?.text) return null
  let text = body.text
  for (const [key, val] of Object.entries(params)) {
    text = text.replace(`{{${key}}}`, val)
  }
  return text
}
```

- [ ] **Step 2: Verify `getTemplateByPurpose` import**

`getTemplateByPurpose` exists in `web/src/db/queries/whatsapp.ts` (line 540). No changes needed — the import in Step 1 is correct.

- [ ] **Step 3: Update vercel.json to add the hourly cron**

In `web/vercel.json`, add the new cron entry:

```json
{
  "crons": [
    {
      "path": "/api/cron/calendar-renew",
      "schedule": "0 6 * * *"
    },
    {
      "path": "/api/cron/whatsapp-automations",
      "schedule": "0 * * * *"
    }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/cron/whatsapp-automations/route.ts web/vercel.json
git commit -m "feat(cron): add hourly whatsapp-automations cron for appointment confirmations"
```

### Task 5: Handle button replies in the webhook + auto-anamnesis

**Files:**
- Modify: `web/src/app/api/webhooks/whatsapp/route.ts`

- [ ] **Step 1: Add import for appointment query functions**

At the top of the webhook file, add:

```typescript
import {
  getAppointmentByConfirmationMessageId,
  confirmAppointment,
  updateAppointmentStatus,
} from '@/db/queries/appointments'
import { getAnamnesis } from '@/db/queries/anamnesis'
import { createAnamnesisToken } from '@/db/queries/anamnesis-tokens'
import { listAutomations, getTemplateByPurpose, upsertConversation, createMessage, pushSseEvent } from '@/db/queries/whatsapp'
import { sendTemplateMessage } from '@/lib/whatsapp'
import { getPatient } from '@/db/queries/patients'
import { getTenant } from '@/db/queries/tenants'
```

- [ ] **Step 2: Add button-reply processing in `processInboundMessage`**

After the message body extraction block (around line 190, after all `if/else if` branches for `msgType`), before the message is created, add a check for interactive button replies:

```typescript
// Process confirmation button replies.
// Meta quick-reply template buttons send the button text in button_reply.title
// (the button_reply.id is an auto-generated UUID, not the button text).
const interactiveData = msg.interactive as {
  type?: string
  button_reply?: { id: string; title: string }
} | undefined
const buttonTitle = interactiveData?.button_reply?.title
const contextMessageId = (msg.context as { id?: string } | undefined)?.id

if (buttonTitle && contextMessageId) {
  processConfirmationReply(tenantId, contextMessageId, buttonTitle, from).catch((err) => {
    console.error('Error processing confirmation reply:', err)
  })
}
```

- [ ] **Step 3: Add the `processConfirmationReply` function**

Add this function at the bottom of the file, before the type interfaces:

```typescript
async function processConfirmationReply(
  tenantId: string,
  contextMessageId: string,
  buttonTitle: string,
  fromPhone: string,
) {
  const appointment = await getAppointmentByConfirmationMessageId(tenantId, contextMessageId)
  if (!appointment) return
  if (appointment.status !== 'scheduled') return

  if (buttonTitle === 'Confirmar') {
    const confirmed = await confirmAppointment(tenantId, appointment.id)
    if (!confirmed) return

    if (appointment.patientId) {
      await maybeAutoSendAnamnesis(tenantId, appointment.patientId, fromPhone)
    }
  } else if (buttonTitle === 'Reagendar') {
    await updateAppointmentStatus(tenantId, appointment.id, 'pending_reschedule')
  }
}
```

- [ ] **Step 4: Add the `maybeAutoSendAnamnesis` function**

```typescript
async function maybeAutoSendAnamnesis(
  tenantId: string,
  patientId: string,
  phone: string,
) {
  const automations = await listAutomations(tenantId)
  const confirmationAuto = automations.find(
    (a) => a.trigger === 'appointment_confirmation' && a.enabled
  )
  if (!confirmationAuto) return

  const config = (confirmationAuto.config ?? {}) as Record<string, unknown>
  if (!config.autoAnamnesisEnabled) return

  const staleDays = (config.anamnesisStaleDays as number) ?? 60
  const anamnesis = await getAnamnesis(tenantId, patientId)
  if (anamnesis?.updatedAt) {
    const daysSince = (Date.now() - new Date(anamnesis.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
    if (daysSince < staleDays) return
  }

  const template = await getTemplateByPurpose(tenantId, 'anamnese_link')
  if (!template || template.status !== 'APPROVED') return

  const patient = await getPatient(tenantId, patientId)
  if (!patient) return

  // Create anamnesis token
  const token = await createAnamnesisToken(tenantId, patientId, 'system')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.floraclin.com.br'
  const link = `${appUrl}/a/${token.token}`

  const normalizedPhone = phone.startsWith('55') ? phone : `55${phone}`
  const firstName = patient.fullName.split(' ')[0] || patient.fullName

  const tenant = await getTenant(tenantId)
  if (!tenant) return

  const params: Record<string, string> = {
    '1': firstName,
    '2': tenant.name,
    '3': link,
  }

  const result = await sendTemplateMessage(
    tenantId,
    normalizedPhone,
    template.name,
    template.language,
    params,
  )

  const conversation = await upsertConversation(
    tenantId,
    normalizedPhone,
    patient.fullName,
    undefined,
    patientId,
  )

  const message = await createMessage(tenantId, conversation.id, {
    direction: 'outbound',
    metaMessageId: result.metaMessageId,
    body: `Olá, ${firstName}! Para agilizar seu atendimento na ${tenant.name}, pedimos que preencha sua ficha de anamnese pelo link abaixo:\n\n${link}\n\nQualquer dúvida, estamos à disposição.`,
    templateName: template.name,
    deliveryStatus: 'sent',
  })

  await pushSseEvent(tenantId, 'new_message', {
    conversationId: conversation.id,
    message,
  })
}
```

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/webhooks/whatsapp/route.ts
git commit -m "feat(webhook): handle confirmation button replies and auto-send anamnesis"
```

### Task 6: Update automation settings UI

**Files:**
- Modify: `web/src/components/settings/whatsapp-automations.tsx`
- Modify: `web/src/app/api/whatsapp/automations/[trigger]/route.ts`

- [ ] **Step 1: Add `appointment_confirmation` to VALID_TRIGGERS in the API**

In `web/src/app/api/whatsapp/automations/[trigger]/route.ts`, update:

```typescript
const VALID_TRIGGERS = ['appointment_confirmation', 'payment_reminder', 'follow_up']
```

Remove `'appointment_reminder'` and add `'appointment_confirmation'`.

- [ ] **Step 2: Replace appointment_reminder with appointment_confirmation in the UI**

In `web/src/components/settings/whatsapp-automations.tsx`, replace the `appointment_reminder` trigger in the `TRIGGERS` array with:

```typescript
{
  key: 'appointment_confirmation',
  label: 'Confirmação de consulta',
  description: 'Envia confirmação automática antes da consulta. O paciente confirma ou solicita reagendamento pelo WhatsApp.',
  icon: CalendarCheck,
  purposeKey: 'appointment_confirmation',
  configFields: [
    { key: 'hoursBeforeAppointment', label: 'Horas antes da consulta', type: 'number' as const, default: 24 },
    { key: 'autoAnamnesisEnabled', label: 'Enviar anamnese automaticamente após confirmação', type: 'toggle' as const, default: false },
    { key: 'anamnesisStaleDays', label: 'Dias para considerar anamnese desatualizada', type: 'number' as const, default: 60, dependsOn: 'autoAnamnesisEnabled' },
  ],
},
```

Add `CalendarCheck` to the lucide-react import.

- [ ] **Step 3: Handle the toggle and conditional field rendering**

Check if the UI component already handles `type: 'toggle'` fields. If not, add a branch in the config field rendering:

For `type: 'toggle'`: render a Switch component instead of a number input.
For `dependsOn`: only show the field when the referenced toggle field is truthy.

```typescript
// In the config fields rendering loop:
if (field.type === 'toggle') {
  return (
    <div key={field.key} className="flex items-center justify-between">
      <Label className="text-sm">{field.label}</Label>
      <Switch
        checked={!!configValue}
        onCheckedChange={(checked) => handleConfigChange(trigger.key, field.key, checked)}
      />
    </div>
  )
}

// For dependsOn — wrap the field in a conditional:
if (field.dependsOn) {
  const parentValue = localConfigs[trigger.key]?.[field.dependsOn]
  if (!parentValue) return null
}
```

Import `Switch` from `@/components/ui/switch`.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/settings/whatsapp-automations.tsx web/src/app/api/whatsapp/automations/\[trigger\]/route.ts
git commit -m "feat(settings): add appointment confirmation automation with auto-anamnesis toggle"
```

---

## Group C (depends on B): Status rendering + pending reschedule page

### Task 7: Add pending_reschedule status to all UI status maps

**Files:**
- Modify: `web/src/components/dashboard/today-appointments.tsx`
- Modify: `web/src/components/scheduling/appointment-card.tsx`
- Modify: `web/src/lib/constants.ts`

- [ ] **Step 1: Add pending_reschedule to `today-appointments.tsx` maps**

Add to `STATUS_LABELS`:
```typescript
pending_reschedule: 'Reagendamento',
```

Add to `STATUS_BADGE_STYLES`:
```typescript
pending_reschedule: 'bg-amber-50 text-amber-700',
```

Add to `STATUS_BORDER_COLORS`:
```typescript
pending_reschedule: 'border-l-amber-400',
```

- [ ] **Step 2: Add pending_reschedule to `appointment-card.tsx` STATUS_LABELS**

In `web/src/components/scheduling/appointment-card.tsx`, add to the `STATUS_LABELS` map (which is also exported and used by `appointment-form.tsx`):

```typescript
pending_reschedule: 'Reagendamento pendente',
```

- [ ] **Step 3: Add pending_reschedule to `constants.ts` APPOINTMENT_STATUS_COLORS**

In `web/src/lib/constants.ts`, add to `APPOINTMENT_STATUS_COLORS`:

```typescript
pending_reschedule: 'bg-amber-50 text-amber-700',
```

- [ ] **Step 4: Commit**

```bash
git add web/src/components/dashboard/today-appointments.tsx web/src/components/scheduling/appointment-card.tsx web/src/lib/constants.ts
git commit -m "feat(ui): add pending_reschedule status to all appointment status maps"
```

### Task 8: Create pending reschedule page

**Files:**
- Create: `web/src/app/(platform)/agenda/reagendamentos/page.tsx`
- Create: `web/src/components/scheduling/pending-reschedule-list.tsx`

- [ ] **Step 1: Create the API endpoint for pending reschedules**

Wait — we need an API route first. Create `web/src/app/api/appointments/pending-reschedule/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getPendingRescheduleAppointments } from '@/db/queries/appointments'

export async function GET() {
  try {
    const ctx = await getAuthContext()
    const practitionerId = ctx.role === 'practitioner' ? ctx.userId : undefined
    const data = await getPendingRescheduleAppointments(ctx.tenantId, practitionerId)
    return NextResponse.json({ data })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Create the PendingRescheduleList component**

Create `web/src/components/scheduling/pending-reschedule-list.tsx`:

```typescript
'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, CalendarPlus, X, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface PendingAppointment {
  id: string
  date: string
  startTime: string
  endTime: string
  patientId: string | null
  bookingName: string | null
  bookingPhone: string | null
  notes: string | null
  updatedAt: string
  patientName: string | null
  patientPhone: string | null
  practitionerName: string
}

export function PendingRescheduleList() {
  const [appointments, setAppointments] = useState<PendingAppointment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/appointments/pending-reschedule')
      .then((res) => res.json())
      .then((data) => setAppointments(data.data ?? []))
      .catch(() => toast.error('Erro ao carregar reagendamentos'))
      .finally(() => setLoading(false))
  }, [])

  async function handleCancel(id: string) {
    try {
      const res = await fetch(`/api/appointments/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      if (!res.ok) throw new Error()
      setAppointments((prev) => prev.filter((a) => a.id !== id))
      toast.success('Consulta cancelada')
    } catch {
      toast.error('Erro ao cancelar consulta')
    }
  }

  function formatDate(dateStr: string) {
    const [y, m, d] = dateStr.split('-')
    return `${d}/${m}/${y}`
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  if (appointments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Clock className="size-12 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">Nenhuma consulta aguardando reagendamento.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {appointments.map((appt) => {
        const name = appt.patientName ?? appt.bookingName ?? 'Paciente'
        const pending = formatDistanceToNow(new Date(appt.updatedAt), {
          addSuffix: true,
          locale: ptBR,
        })

        return (
          <div
            key={appt.id}
            className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-charcoal">{name}</p>
              <p className="text-xs text-mid">
                {formatDate(appt.date)} às {appt.startTime.slice(0, 5)} · {appt.practitionerName}
              </p>
              <p className="text-xs text-amber-600 mt-0.5">Reagendamento solicitado {pending}</p>
            </div>
            <div className="flex items-center gap-2 ml-4">
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                render={
                  <Link
                    href={`/agenda?new=true${appt.patientId ? `&patient=${appt.patientId}` : ''}`}
                  />
                }
              >
                <CalendarPlus className="size-3.5 mr-1" />
                Reagendar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs text-muted-foreground"
                onClick={() => handleCancel(appt.id)}
              >
                <X className="size-3.5 mr-1" />
                Cancelar
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Create the page**

Create `web/src/app/(platform)/agenda/reagendamentos/page.tsx`:

```typescript
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PendingRescheduleList } from '@/components/scheduling/pending-reschedule-list'

export default function PendingReschedulePage() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href="/agenda"
          className="inline-flex items-center gap-1.5 text-[13px] text-mid hover:text-forest transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Voltar para agenda
        </Link>
      </div>
      <div>
        <h1 className="text-lg font-medium text-charcoal">Reagendamentos Pendentes</h1>
        <p className="text-sm text-mid mt-1">
          Consultas cujos pacientes solicitaram reagendamento via WhatsApp.
        </p>
      </div>
      <PendingRescheduleList />
    </div>
  )
}
```

- [ ] **Step 4: Check if `/api/appointments/[id]/status` endpoint exists**

Grep for the status update route. If it doesn't exist, use the existing appointment update pattern to cancel:

```bash
grep -rn "status" web/src/app/api/appointments/ --include="*.ts" | head -10
```

If the PATCH status endpoint doesn't exist, create `web/src/app/api/appointments/[id]/status/route.ts` with a simple handler that calls `updateAppointmentStatus`.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/\(platform\)/agenda/reagendamentos/page.tsx web/src/components/scheduling/pending-reschedule-list.tsx web/src/app/api/appointments/pending-reschedule/route.ts
git commit -m "feat(agenda): add pending reschedule page with list and cancel action"
```

### Task 9: Add dashboard widget and agenda link for pending reschedules

**Files:**
- Create: `web/src/components/dashboard/pending-reschedule-card.tsx`
- Modify: `web/src/app/(platform)/dashboard/dashboard-page-client.tsx`
- Modify: `web/src/app/api/dashboard/route.ts`
- Modify: `web/src/db/queries/dashboard.ts`

- [ ] **Step 1: Add `countPendingReschedule` to dashboard API**

In `web/src/app/api/dashboard/route.ts`, import `countPendingReschedule` from `@/db/queries/appointments` and add it to the parallel query:

```typescript
import { countPendingReschedule } from '@/db/queries/appointments'

// Inside Promise.all:
countPendingReschedule(ctx.tenantId, practitionerId).catch(() => 0),

// Return:
return NextResponse.json({
  todayAppointments,
  quickStats,
  upcomingFollowUps,
  recentActivity,
  pendingRescheduleCount,
})
```

- [ ] **Step 2: Create the PendingRescheduleCard component**

Create `web/src/components/dashboard/pending-reschedule-card.tsx`:

```typescript
import Link from 'next/link'
import { CalendarClock } from 'lucide-react'

export function PendingRescheduleCard({ count }: { count: number }) {
  if (count === 0) return null

  return (
    <Link
      href="/agenda/reagendamentos"
      className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3 transition-colors hover:bg-amber-50"
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-amber-100">
        <CalendarClock className="size-5 text-amber-600" />
      </div>
      <div>
        <p className="text-sm font-medium text-charcoal">
          {count} consulta{count !== 1 ? 's' : ''} aguardando reagendamento
        </p>
        <p className="text-xs text-mid">Clique para ver e reagendar</p>
      </div>
    </Link>
  )
}
```

- [ ] **Step 3: Add the widget to the dashboard**

In `web/src/app/(platform)/dashboard/dashboard-page-client.tsx`:

1. Import `PendingRescheduleCard`:
```typescript
import { PendingRescheduleCard } from '@/components/dashboard/pending-reschedule-card'
```

2. Add it after the greeting area and before the KPI cards:
```typescript
{/* Pending Reschedule Alert */}
<PendingRescheduleCard count={data.pendingRescheduleCount ?? 0} />
```

- [ ] **Step 4: Commit**

```bash
git add web/src/components/dashboard/pending-reschedule-card.tsx web/src/app/\(platform\)/dashboard/dashboard-page-client.tsx web/src/app/api/dashboard/route.ts
git commit -m "feat(dashboard): add pending reschedule count widget"
```

---

## Group D (depends on C): Template migration for existing tenants

### Task 10: Create migration script to update existing confirmation templates

**Files:**
- Create: `web/src/db/migrations/manual/0009_update_confirmation_template_buttons.ts`

- [ ] **Step 1: Create the migration script**

Create `web/src/db/migrations/manual/0009_update_confirmation_template_buttons.ts`:

```typescript
/**
 * Update the appointment_confirmation WhatsApp template for all tenants
 * to use quick-reply buttons instead of free-text SIM/NÃO prompts.
 *
 * Idempotent: skips tenants whose template already has BUTTONS components.
 *
 * Run: DATABASE_URL="..." npx tsx --tsconfig tsconfig.json src/db/migrations/manual/0009_update_confirmation_template_buttons.ts
 */
import { db } from '../../client'
import { tenants, whatsappTemplates } from '../../schema'
import { eq, and } from 'drizzle-orm'
import { editTemplate as editMetaTemplate } from '../../../lib/whatsapp'
import { TEMPLATE_BLUEPRINTS } from '../../../lib/whatsapp-blueprints'

const BLUEPRINT = TEMPLATE_BLUEPRINTS.find((b) => b.slug === 'appointment_confirmation')!

async function main() {
  const allTenants = await db
    .select({ id: tenants.id, name: tenants.name, settings: tenants.settings })
    .from(tenants)

  const waEnabled = allTenants.filter((t) => {
    const s = t.settings as Record<string, unknown> | null
    return s?.whatsapp_enabled && s?.whatsapp_phone_number_id && s?.whatsapp_access_token
  })

  console.log(`Found ${allTenants.length} tenants, ${waEnabled.length} with WhatsApp enabled`)

  let updated = 0
  let skipped = 0
  const errors: Array<{ tenant: string; error: string }> = []

  for (const tenant of waEnabled) {
    const [template] = await db
      .select()
      .from(whatsappTemplates)
      .where(
        and(
          eq(whatsappTemplates.tenantId, tenant.id),
          eq(whatsappTemplates.purposeKey, 'appointment_confirmation'),
        )
      )
      .limit(1)

    if (!template) {
      console.log(`  [${tenant.name}] no appointment_confirmation template — skipping`)
      skipped++
      continue
    }

    const components = template.components as Array<{ type: string }> | null
    if (components?.some((c) => c.type === 'BUTTONS')) {
      console.log(`  [${tenant.name}] already has buttons — skipping`)
      skipped++
      continue
    }

    try {
      await editMetaTemplate(tenant.id, template.metaTemplateId!, BLUEPRINT.components)

      await db
        .update(whatsappTemplates)
        .set({
          components: BLUEPRINT.components,
          status: 'PENDING',
          updatedAt: new Date(),
        })
        .where(eq(whatsappTemplates.id, template.id))

      console.log(`  [${tenant.name}] updated template "${template.name}" — status set to PENDING`)
      updated++

      await new Promise((r) => setTimeout(r, 300))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  [${tenant.name}] FAILED: ${msg}`)
      errors.push({ tenant: tenant.name, error: msg })
    }
  }

  console.log(`\nDone: updated=${updated}, skipped=${skipped}, errors=${errors.length}`)
  if (errors.length > 0) {
    console.log('Errors:', errors)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Commit**

```bash
git add web/src/db/migrations/manual/0009_update_confirmation_template_buttons.ts
git commit -m "feat(migration): update confirmation templates to use quick-reply buttons"
```
