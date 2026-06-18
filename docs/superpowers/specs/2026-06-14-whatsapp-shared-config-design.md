# WhatsApp Shared Config + Credits

## Goal

Replace the current "bring your own Meta app" WhatsApp setup with a two-option model: **Option A** (default) uses FloraClin's shared WhatsApp number with a monthly credit system, and **Option B** lets clinics with an active paid subscription use their own number. This removes the 7-step Meta developer setup for the majority of clinics.

## Context

The current WhatsApp integration requires every clinic to create a Meta developer app, configure webhooks, generate system user tokens, and manage templates — a process that's too technical for most clinic owners. This spec introduces a shared FloraClin WhatsApp Business number that all clinics can use out of the box, with per-tenant conversation credits to control costs.

**Depends on:** [Subscriptions & Plans spec](2026-06-14-subscriptions-plans-design.md) for `checkPlanLimit`, `checkPlanFeature`, and the `tenant_subscriptions` infrastructure.

---

## Architecture

### Two WhatsApp modes

| | Option A: FloraClin (default) | Option B: Próprio número |
|---|---|---|
| Setup required | None — works immediately | Full Meta developer setup (existing 7-step guide) |
| Sender identity | FloraClin shared number | Clinic's own WhatsApp Business number |
| Clinic name in messages | Via template variables (e.g. "Olá {{1}}! Sua consulta na {{2}}...") | Native — their own number/profile |
| Templates | Managed by FloraClin platform | Clinic manages their own via Meta |
| Cost model | Monthly conversation credits (from plan) | Clinic pays Meta directly |
| Subscription required | No (included in free trial) | Yes (starter or pro plan) |
| Webhook routing | Shared webhook, routed by internal tenant mapping | Shared webhook, routed by `phone_number_id` (existing) |

### Credential resolution

The `getCredentials(tenantId)` function in `lib/whatsapp.ts` currently reads from `tenant.settings`. It will be updated to:

1. Check `tenant.settings.whatsapp_mode` — `'floraclin'` (Option A) or `'own'` (Option B).
2. If `'floraclin'`: return system-level credentials from environment variables.
3. If `'own'`: return tenant-specific credentials from `tenant.settings` (existing behavior).

```ts
async function getCredentials(tenantId: string) {
  const tenant = await getTenant(tenantId)
  const settings = tenant.settings as Record<string, unknown>
  const mode = (settings.whatsapp_mode as string) ?? 'floraclin'

  if (mode === 'own') {
    // existing per-tenant credential logic
    return { phoneNumberId: settings.whatsapp_phone_number_id, ... }
  }

  // Option A: system credentials
  return {
    phoneNumberId: process.env.FLORACLIN_WA_PHONE_NUMBER_ID,
    businessAccountId: process.env.FLORACLIN_WA_BUSINESS_ACCOUNT_ID,
    accessToken: process.env.FLORACLIN_WA_ACCESS_TOKEN,
  }
}
```

### Environment variables (new)

| Variable | Purpose |
|---|---|
| `FLORACLIN_WA_PHONE_NUMBER_ID` | Shared FloraClin WhatsApp phone number ID |
| `FLORACLIN_WA_BUSINESS_ACCOUNT_ID` | Shared FloraClin WhatsApp Business Account ID |
| `FLORACLIN_WA_ACCESS_TOKEN` | System user token for the shared number |

---

## Credit System

### Data model

**`whatsapp_credits` table** — tracks monthly credit usage per tenant:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenantId` | uuid FK → tenants | |
| `periodStart` | timestamptz | First day of the billing month |
| `periodEnd` | timestamptz | Last day of the billing month |
| `creditsTotal` | integer | Monthly allowance from plan (e.g. 50, 300, 1000) |
| `creditsUsed` | integer | Conversations opened this period |
| `createdAt` | timestamptz | |
| `updatedAt` | timestamptz | |

**Unique constraint:** `(tenantId, periodStart)` — one record per tenant per month.

### Credit lifecycle

1. **Period creation:** Lazily created on first message send attempt in a new billing month. The `creditsTotal` is read from the tenant's current plan limits (`whatsapp_conversations`).
2. **Credit consumption:** When a message is sent via Option A, check if a conversation is already open with that phone number (within 24h of last outbound). If not, it's a new conversation → increment `creditsUsed`.
3. **Credit check:** Before sending, compare `creditsUsed < creditsTotal`. If not, block the send and return an error.
4. **Monthly reset:** No cron needed — each new month creates a fresh row with `creditsUsed: 0`. Old rows are kept for usage history.

### Conversation tracking

The existing `whatsapp_conversations` table already tracks `lastMessageAt` per conversation. To determine if a message opens a new conversation (costs a credit):

```ts
async function consumeCredit(tenantId: string, recipientPhone: string): Promise<{
  allowed: boolean
  creditsUsed: number
  creditsTotal: number
}> {
  // 1. Check if there's an open conversation (outbound message within 24h)
  const existingConversation = await findOpenConversation(tenantId, recipientPhone)
  if (existingConversation) {
    return { allowed: true, creditsUsed: current.creditsUsed, creditsTotal: current.creditsTotal }
  }

  // 2. No open conversation → this costs a credit
  const credits = await getOrCreateCurrentPeriod(tenantId)
  if (credits.creditsUsed >= credits.creditsTotal) {
    return { allowed: false, creditsUsed: credits.creditsUsed, creditsTotal: credits.creditsTotal }
  }

  // 3. Increment and allow
  await incrementCreditsUsed(tenantId, credits.id)
  return { allowed: true, creditsUsed: credits.creditsUsed + 1, creditsTotal: credits.creditsTotal }
}
```

### Open conversation definition

A conversation is "open" if a message was sent to that recipient within the last 24 hours. This mirrors Meta's conversation window. Check the `whatsapp_messages` table:

```sql
SELECT 1 FROM whatsapp_messages m
JOIN whatsapp_conversations c ON c.id = m.conversation_id
WHERE c.tenant_id = $1
  AND c.phone = $2
  AND m.direction = 'outbound'
  AND m.created_at > now() - interval '24 hours'
LIMIT 1
```

If a row exists, the conversation is still open and no credit is charged.

---

## Template Management (Option A)

### System-managed templates

Clinics on Option A cannot create their own Meta templates (they don't have access to the Meta app). Instead, FloraClin manages a set of shared templates on the system WhatsApp Business Account.

**Shared templates** use clinic name as a variable:
- `floraclin_appointment_confirmation` — "Olá {{1}}! Confirmamos sua consulta na {{2}} no dia {{3}}, às {{4}}. Por favor, confirme abaixo."
- `floraclin_anamnese_link` — "Olá {{1}}! Para agilizar seu atendimento na {{2}}, preencha sua anamnese..."
- etc.

Where `{{2}}` is always the clinic's name (`tenant.name`).

### Template resolution

The existing `getTemplateByPurpose(tenantId, purposeKey)` function queries `whatsapp_templates` for per-tenant templates. For Option A, templates are stored as system-level rows (with a `tenantId` of null or a special system tenant ID) and resolved by `purposeKey` when the mode is `'floraclin'`.

Approach: add a `systemTemplate` boolean column to `whatsapp_templates`, or resolve by checking mode:

```ts
async function getTemplateByPurpose(tenantId: string, purposeKey: string) {
  const mode = await getWhatsAppMode(tenantId)
  if (mode === 'floraclin') {
    return getSystemTemplate(purposeKey)
  }
  return getTenantTemplate(tenantId, purposeKey)
}
```

System templates are seeded via migration and point to the templates registered on the FloraClin shared Meta app.

---

## Webhook Routing (Option A)

### Inbound messages

The existing webhook at `/api/webhooks/whatsapp` routes by `phone_number_id`. For Option A, all clinics share one `phone_number_id` (the FloraClin system number), so the lookup changes:

1. Extract `phone_number_id` from webhook payload.
2. If it matches `FLORACLIN_WA_PHONE_NUMBER_ID` (the shared number):
   - Extract the recipient phone (`to` field for outbound status, `from` for inbound).
   - Look up which tenant has an active conversation with that phone number.
   - If no existing conversation, check the `wa_contact_id` or `display_phone_number` from the contact object.
3. If it matches a tenant's own `phone_number_id`: existing behavior (per-tenant routing).

### Tenant resolution for shared number

When a patient replies to a message sent from the shared number, we need to find the right tenant. The `whatsapp_conversations` table already stores `tenantId` + `phone`. When the inbound message arrives:

```ts
const conversation = await db
  .select()
  .from(whatsappConversations)
  .where(and(
    eq(whatsappConversations.phone, senderPhone),
    // Only match tenants using the shared number
    // Order by most recent message to handle the (rare) case of
    // a patient visiting multiple clinics on the shared number
  ))
  .orderBy(desc(whatsappConversations.lastMessageAt))
  .limit(1)
```

If no existing conversation is found (patient messages the shared number unprompted), the message is logged but not routed — there's no way to know which clinic they want. A future enhancement could add a welcome message asking which clinic.

---

## Settings UI Changes

### New layout for WhatsApp settings

Replace the current single-form approach with a mode selector:

```
┌──────────────────────────────────────────────────┐
│ WhatsApp                                         │
│                                                  │
│ ┌─────────────────────┐ ┌──────────────────────┐ │
│ │ ● FloraClin (Padrão)│ │ ○ Número próprio     │ │
│ │                     │ │                      │ │
│ │ Pronto para uso.    │ │ Use seu próprio      │ │
│ │ Seus pacientes      │ │ número do WhatsApp   │ │
│ │ receberão mensagens │ │ Business.            │ │
│ │ do número FloraClin.│ │                      │ │
│ │                     │ │ Requer plano Starter │ │
│ │ Créditos: 32/50     │ │ ou superior.         │ │
│ │ ████████░░ 64%      │ │                      │ │
│ │ Renovam em 18 dias  │ │ [Fazer upgrade]      │ │
│ └─────────────────────┘ └──────────────────────┘ │
│                                                  │
│ ── Perfis com Acesso ──────────────────────────── │
│ ☑ Proprietário  ☑ Profissional                   │
│ ☑ Recepcionista ☐ Financeiro                     │
│                                                  │
│ ── Automações ─────────────────────────────────── │
│ [existing automations section]                   │
│                                                  │
│                            [Salvar Configurações] │
└──────────────────────────────────────────────────┘
```

**Option A selected (default):**
- No credential inputs shown.
- Credit usage bar shown (current/total, percentage, days until renewal).
- Templates section hidden (system-managed).
- Automations section visible (same triggers, system templates used).

**Option B selected:**
- Full credential form shown (existing: Phone Number ID, Business Account ID, Access Token).
- Setup guide accordion shown (existing 7-step guide).
- Webhook URL and Verify Token shown.
- Templates section shown (existing template management).
- Automations section visible.
- Disabled with "Requer plano Starter ou superior" message + upgrade link if on free plan.

### Credit usage component

A reusable component showing:
- Progress bar: `creditsUsed / creditsTotal`
- Text: "32 de 50 conversas usadas"
- Renewal date: "Renovam em X dias" (based on `currentPeriodEnd` from subscription)
- Color: green (< 70%), amber (70-90%), red (> 90%)

When credits are exhausted (100%):
- Red bar, text: "Créditos esgotados"
- Message: "Suas mensagens estão pausadas até a renovação em X dias. Para enviar agora, faça upgrade do seu plano."
- Upgrade button

---

## Message Send Flow (Updated)

### Before (current)

```
sendTemplateMessage(tenantId, to, ...) 
  → getCredentials(tenantId) → tenant.settings
  → POST to Meta API
```

### After

```
sendTemplateMessage(tenantId, to, ...)
  → getCredentials(tenantId)
    → if mode === 'floraclin':
        → consumeCredit(tenantId, to)
          → if not allowed: throw CreditExhaustedError
          → if allowed: continue
        → return system env credentials
    → if mode === 'own':
        → return tenant.settings credentials (existing)
  → POST to Meta API
```

### Error handling

- `CreditExhaustedError` — caught by the cron job and manual send flows. Cron logs it and skips. Manual send shows a toast: "Créditos esgotados. Faça upgrade do plano ou aguarde a renovação."
- The cron job (`whatsapp-automations`) checks credits before each message. If credits run out mid-batch, remaining appointments are skipped (not queued — they'll be picked up if credits are available next run or next month).

---

## Tenant Settings Changes

### New settings fields

| Field | Type | Default | Notes |
|---|---|---|---|
| `whatsapp_mode` | `'floraclin' \| 'own'` | `'floraclin'` | Which WhatsApp config to use |

Existing fields (`whatsapp_phone_number_id`, `whatsapp_business_account_id`, `whatsapp_access_token`) remain — they're only used when `whatsapp_mode === 'own'`.

The `whatsapp_enabled` toggle is removed from the UI. WhatsApp is always enabled on Option A (credits permitting). On Option B, it's enabled when credentials are configured and verified.

---

## Migration

1. Add `whatsapp_credits` table.
2. Add `systemTemplate` boolean column to `whatsapp_templates` (default false).
3. Seed system templates for the shared FloraClin number.
4. For existing tenants with WhatsApp credentials configured:
   - Set `whatsapp_mode: 'own'` in their settings.
5. For existing tenants without WhatsApp credentials:
   - Set `whatsapp_mode: 'floraclin'` (default).
6. All tenants: `whatsapp_enabled` defaults to true (the mode controls behavior now).

---

## Scope Boundaries

### In scope
- `whatsapp_credits` table and credit tracking logic
- `getCredentials` refactor for dual-mode resolution
- `consumeCredit` function with open-conversation detection
- Settings UI: mode selector, credit usage bar, conditional credential form
- Template resolution for system vs tenant templates
- System template seed data
- Webhook routing update for shared number inbound messages
- Cron job update to check credits before sending
- Error handling for exhausted credits

### Out of scope (future)
- Welcome message for unsolicited inbound on shared number
- Credit top-up / overage purchasing
- Per-conversation-category credit costs (utility vs marketing)
- Shared number template approval workflow in UI
- Analytics dashboard for credit usage trends
- Multi-shared-number support (e.g. regional numbers)

---

## Relationship to Spec 1 (Subscriptions & Plans)

This spec depends on Spec 1 for:
- **`checkPlanLimit(tenantId, 'whatsapp_conversations')`** — provides the monthly credit allowance (creditsTotal)
- **`checkPlanFeature(tenantId, 'own_whatsapp_number')`** — gates Option B availability
- **`subscriptionStatus`** in session — blocks feature access when expired
- **Plan tiers define credit amounts** — free: 50, starter: 300, pro: 1000
