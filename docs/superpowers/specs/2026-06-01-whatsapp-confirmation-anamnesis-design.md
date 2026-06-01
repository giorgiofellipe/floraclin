# WhatsApp Appointment Confirmation + Auto-Anamnesis

## Goal

Automate appointment confirmations via WhatsApp with interactive buttons, and automatically send anamnesis links to patients who confirm when their anamnesis is stale. Replace the existing `appointment_reminder` trigger — the confirmation message serves both purposes.

## Architecture

A single hourly Vercel cron job (`/api/cron/whatsapp-automations`) iterates all WhatsApp-enabled tenants, finds upcoming appointments within the configured window, and sends confirmation messages with quick-reply buttons ("Confirmar" / "Reagendar"). The existing webhook handler processes button replies: confirming updates the appointment status and triggers anamnesis evaluation; requesting reschedule marks the appointment as `pending_reschedule` and optionally sends a self-service scheduling link.

## Data Model Changes

### Appointments table — new columns

| Column | Type | Purpose |
|--------|------|---------|
| `confirmationSentAt` | `timestamptz NULL` | When the confirmation was sent. Idempotency key: if set, don't re-send. |
| `confirmedAt` | `timestamptz NULL` | When the patient tapped "Confirmar". |
| `confirmationMessageId` | `varchar(100) NULL` | Meta message ID to correlate button replies back to the appointment. |

### Appointment status — add value

Add `pending_reschedule` to the CHECK constraint. Status flow:

```
scheduled → (cron sends confirmation) → scheduled (confirmationSentAt set)
         → (patient taps Confirmar)   → confirmed (confirmedAt set)
         → (patient taps Reagendar)   → pending_reschedule
```

### Automation config shape

The `appointment_confirmation` trigger stores its config as JSON in `whatsappAutomations.config`:

```json
{
  "hoursBeforeAppointment": 24,
  "autoAnamnesisEnabled": true,
  "anamnesisStaleDays": 60
}
```

No new tables required.

## Confirmation Template

### Blueprint change

Update the `appointment_confirmation` blueprint in `whatsapp-blueprints.ts`:

- **Body**: Keep existing text (greeting + appointment details)
- **Buttons**: Replace free-text SIM/NÃO prompt with two quick-reply buttons:
  - Button 1: text `"Confirmar"`, payload `CONFIRM_APPOINTMENT`
  - Button 2: text `"Reagendar"`, payload `RESCHEDULE_APPOINTMENT`

### Migration for existing tenants

A one-time migration script (following the `0008_provision_consent_signing_template.ts` pattern):

1. Query all tenants with `whatsapp_enabled` that have an `appointment_confirmation` template
2. For each tenant: call Meta's `editTemplate` API with the new components (body + quick-reply buttons)
3. Update the local `whatsappTemplates` record with new components and set status to `PENDING`

Meta re-reviews edited templates (usually minutes to hours). During review, the template can't be sent — the cron skips tenants whose confirmation template isn't `APPROVED`.

## Cron Job

### Route

`/api/cron/whatsapp-automations` — protected by `CRON_SECRET` bearer token.

### Schedule

Every hour. Added to `vercel.json`:

```json
{ "path": "/api/cron/whatsapp-automations", "schedule": "0 * * * *" }
```

### Confirmation send flow

1. Query all tenants with `whatsapp_enabled = true`
2. For each tenant:
   a. Check if `appointment_confirmation` automation is enabled and its linked template has `status = 'APPROVED'`
   b. Read `hoursBeforeAppointment` from automation config (default 24)
   c. Find appointments where:
      - `status = 'scheduled'`
      - `confirmationSentAt IS NULL`
      - Appointment datetime is within the next `hoursBeforeAppointment` hours
      - Has a reachable phone: either `patientId` with a phone via join, or `bookingPhone` directly
   d. For each appointment: send the confirmation template, set `confirmationSentAt = now()`, store `confirmationMessageId` from Meta's response
3. Idempotent: `confirmationSentAt IS NULL` prevents re-sends across cron runs

### Template variables

The confirmation template uses: `patient_name` (or `bookingName`), `clinic_name`, `appointment_date`, `appointment_time`.

## Webhook — Button Reply Handling

In the existing webhook handler (`/api/webhooks/whatsapp`), when an inbound message has `type: 'interactive'` with `interactive.type: 'button_reply'`:

### CONFIRM_APPOINTMENT payload

1. Look up appointment by `confirmationMessageId` matching the `context.message_id` from the webhook
2. If appointment `status` is not `scheduled` (already cancelled, etc.) — ignore
3. Set `status = 'confirmed'`, `confirmedAt = now()`
4. Run anamnesis check (see below)

### RESCHEDULE_APPOINTMENT payload

1. Look up appointment by `confirmationMessageId`
2. If appointment `status` is not `scheduled` — ignore
3. Set `status = 'pending_reschedule'`
4. If tenant has self-service scheduling enabled: auto-send the scheduling link via the existing conversation

## Anamnesis Auto-Send

Triggered immediately after a `CONFIRM_APPOINTMENT` reply is processed.

### Conditions (all must be true)

1. Automation config has `autoAnamnesisEnabled: true`
2. Appointment has a `patientId` (not a booking-only appointment)
3. Patient's latest `anamnesis.updatedAt` is null (never filled) or older than `anamnesisStaleDays` (default 60)
4. Tenant has an `anamnese_link` template with `status = 'APPROVED'`

### Action

1. Generate anamnesis token via existing `createAnamnesisToken()` (2-hour expiry)
2. Build the link: `{appUrl}/a/{token}`
3. Send the `anamnese_link` template via the existing conversation with the patient
4. Log the message in `whatsappMessages`

### Skip silently if

- `autoAnamnesisEnabled` is false
- No `patientId` on the appointment
- Anamnesis is fresh (within `anamnesisStaleDays`)
- `anamnese_link` template doesn't exist or isn't approved

## UI — Automation Settings

### Confirmation card

In the WhatsApp automations settings (`/configuracoes`), replace the `appointment_reminder` card with:

**"Confirmação de consulta"**

- Toggle: enabled/disabled
- Field: "Horas antes da consulta" (number input, default 24)
- Toggle: "Enviar anamnese automaticamente após confirmação"
- Field (visible when auto-anamnesis on): "Dias para considerar anamnese desatualizada" (number input, default 60)

Remove (or hide) the `appointment_reminder` card since confirmation replaces it.

## UI — Pending Reschedule

### Page: `/agenda/reagendamentos`

Filtered list of appointments with `status = 'pending_reschedule'`.

Each row shows:
- Patient name (or `bookingName` if no linked patient)
- Original date and time
- Practitioner name
- Time pending (e.g., "há 2 dias")
- Actions: "Reagendar" (opens appointment form pre-filled with patient data), "Cancelar"

### Agenda access

Accessible from the agenda page via a tab or link showing the count: "Reagendamentos (3)". Count badge highlights when > 0.

### Agenda view badge

Appointments with `pending_reschedule` in the calendar view get an amber badge, distinct from confirmed (green) and cancelled (red).

### Dashboard widget

A card on the main dashboard showing the count of pending reschedules when > 0. Example: "3 consultas aguardando reagendamento" with a link to `/agenda/reagendamentos`.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Appointment cancelled before patient replies | Ignore the button reply (status already `cancelled`) |
| Multiple appointments same patient same day | Each gets its own confirmation with unique `confirmationMessageId` — replies are unambiguous |
| Template not yet approved (new or re-submitted) | Cron skips that tenant |
| Appointment has no patient or phone | Skip confirmation send |
| Appointment has `bookingPhone` but no `patientId` | Send confirmation, skip anamnesis |
| Anamnesis link template missing | Send confirmation, skip anamnesis (log warning) |
| Patient replies after appointment time has passed | Still process the reply — staff can see the status change |
| Cron runs multiple times within window | Idempotent via `confirmationSentAt IS NULL` check |
