# Clínica Lumé: demo tenant for marketing screenshots

**Goal:** a fictional but believable tenant in production, populated so every
screen worth capturing looks like a busy premium HOF clinic.

**Environment:** production Supabase, same database as real clinics.
**Isolation:** one tenant id, everything keyed to it, one-command teardown.

---

## 0. Non-negotiable safety rails

Production means real side effects. These come first and get verified before any
patient row is written.

### 0.1 No outbound WhatsApp

`app/api/cron/whatsapp-automations/route.ts` selects **every** tenant and treats
an unset `whatsapp_mode` as `'floraclin'`, i.e. enabled by default. It then sends
appointment confirmations for today and tomorrow. This demo needs appointments
today and 15 days forward, so without intervention the next cron run messages
whoever owns the seeded numbers.

Four independent layers, all of them applied:

1. **Tenant settings exclude it from the cron.** The filter keeps a tenant when
   `mode === 'floraclin'`, otherwise when `whatsapp_enabled` is truthy. So set
   `settings.whatsapp_mode = 'own'` and `settings.whatsapp_enabled = false`.
2. **No automations rows.** Even past the filter, the cron skips a tenant with no
   enabled `appointment_confirmation` automation. Create none.
3. **No WhatsApp credentials.** No phone number id, no token, so a send cannot be
   constructed even if something calls it directly.
4. **Non-routable numbers.** Every patient phone is `(11) 90000-0XXX`. If the
   first three layers somehow fail, the payloads still go nowhere real.

### 0.2 No outbound email

Every patient email is `nome.sobrenome@example.com` (RFC 2606 reserves
`example.com` precisely for this). No real inbox can receive anything.

### 0.3 Seed by direct DB insert, never through the app

The API and UI layers fire automations, send anamnesis links, move CRM stages and
dispatch signature requests. Writing rows directly is what makes those side
effects structurally impossible, not just disabled.

### 0.4 The subscription must not expire mid-shoot

`getExpiredTrials` flips subscriptions whose `currentPeriodEnd` has passed. Seed
an `active` subscription with `currentPeriodEnd` a year out, no Stripe ids. This
also keeps trial banners and the expiry block out of every screenshot.

### 0.5 Marked as demo

`settings.is_demo = true` and a recognisable name, so nobody later mistakes it
for a paying clinic in the admin list or in platform metrics.

---

## 1. What the product actually shows

Confirmed against the queries, not assumed. The brief's Painel section is mostly
metrics that do not exist; those are dropped.

**Dashboard** (`getQuickStats`) renders exactly three numbers:

| Shown | Source |
|---|---|
| Pacientes na semana | distinct `appointments.patientId` in the current ISO week |
| Procedimentos no mês | count of `procedureRecords` by `performedAt` in the current month |
| Faturamento no mês | sum of `installments.amount` where `status = 'paid'` and `paidAt` in the current month |

Dropped from the brief, because no such feature exists: meta mensal and its 76%,
ticket médio, novos vs retornos, a receber on the dashboard.

**Financeiro › Visão Geral** (`getRevenueOverview`) renders:

- `totalReceived`, `totalPending`, `totalOverdue`
- monthly series grouped by `installments.paidAt`
- revenue by procedure type, **ranked by revenue, not by session count**
- `totalExpenses`, and `netProfit = totalReceived − totalExpenses`

Three traps this creates:

1. `totalPending` only counts installments with `dueDate >= CURRENT_DATE`.
   The R$ 7.800 must be dated forward or it renders as **overdue**.
2. The summary filters on `financialEntries.createdAt` while the chart groups by
   `installments.paidAt`. Both need back-dating or the two disagree.
3. "Procedimento mais realizado" is a revenue ranking. Toxina at 9 sessions will
   not top it; Harmonização completa will.

---

## 2. Numbers, solved backwards

Everything is generated **relative to the run date**, never hardcoded to a month.

### 2.1 Current month

| Figure | Value | How it is produced |
|---|---|---|
| Procedimentos no mês | 23 | 23 `procedureRecords` with `performedAt` this month |
| Recebido | R$ 34.200 | paid installments, `paidAt` this month |
| A receber | R$ 7.800 | pending installments, `dueDate` next month |
| Bruto | R$ 42.000 | the two above |
| Despesas pagas | R$ 8.400 | aluguel 4.500, materiais 2.600, plataformas 1.300 |
| Lucro líquido | R$ 25.800 | `34.200 − 8.400`, computed by the app |

### 2.2 The 23-procedure mix

Chosen so the count, the toxina/preenchimento session counts and the gross all
land together:

| Procedimento | Preço | Qtd | Subtotal |
|---|---|---|---|
| Harmonização facial completa | 4.500 | 2 | 9.000 |
| Bioestimulador (Sculptra) | 2.200 | 3 | 6.600 |
| Toxina botulínica completa | 1.800 | 6 | 10.800 |
| Toxina botulínica parcial | 900 | 3 | 2.700 |
| Preenchimento de olheiras | 1.600 | 2 | 3.200 |
| Preenchimento malar | 1.500 | 2 | 3.000 |
| Preenchimento labial | 1.400 | 2 | 2.800 |
| Skinbooster | 1.200 | 2 | 2.400 |
| Limpeza de pele profunda | 350 | 1 | 350 |
| **Total** | | **23** | **40.850** |

Toxina 9 sessions and preenchimento 6 both match the brief.

The list price total is 40.850, not 42.000. These prices admit no combination of
23 items that hits 42.000 exactly, so the gap closes the way a real clinic closes
it: **one Harmonização sold as a package at R$ 5.650 instead of 4.500**, which is
a plausible bundled price and lands the gross exactly on 42.000. The script
asserts the total and fails loudly if the mix drifts.

### 2.3 Six-month trend

Paid installments back-dated by `paidAt`, ending at the current month:

| Month (relative) | Received |
|---|---|
| current − 5 | R$ 18.200 |
| current − 4 | R$ 22.500 |
| current − 3 | R$ 26.800 |
| current − 2 | R$ 29.400 |
| current − 1 | R$ 37.100 |
| current | R$ 34.200 |

The current month reads lower than its 42.000 gross because 7.800 is still
unpaid. That is correct and reads naturally as a month in progress.

Prior months need roughly 95 more procedures to carry R$ 134.000, which is why
patient count goes to **50**, not 20. Twenty patients would imply six procedures
each in six months, which contradicts "premium com pacientes fiéis".

---

## 3. Data to create

1. **Tenant** Clínica Lumé, São Paulo SP, settings per §0.
2. **Users**: Dra. Camila Ferreira (CRO-SP 12.847) as practitioner and owner,
   with a known shoot password; one recepção account for role screenshots.
3. **Subscription**: active, period end +1 year.
4. **Procedure types**: the nine above at list price.
5. **Patients**: 50. Mostly female, ages 24–45, valid-format CPF, `(11) 90000-0XXX`,
   `@example.com`, referral split across Instagram / indicação / Google.
   At least 12 with 3+ visits, at least 5 with a scheduled return.
6. **History**: ~118 appointments and procedure records across six months, with
   financial entries and installments back-dated to produce §2.3.
7. **Expenses**: recurring aluguel, materiais and plataformas across all six months.
8. **Today**: 4 appointments 09:00–17:00, 3 confirmed and 1 pending.
9. **Next 15 days**: 3–5 per day, **Monday to Saturday**, Sundays closed. Two
   encaixes this week. A clinic open seven days reads less real, not more.
10. **Prontuários** for 6 featured patients: anamnese, procedure record with
    produto/quantidade/técnica, observações, próxima avaliação, plus a **face
    diagram** with points and doses, since that is the flagship screen.
11. **Antes/depois**: the illustration templates already in the repo
    (`female-front.webp` and `female-front-antes.webp`), registered on the eye
    line so the comparison slider works.

Names, prices and intervals get natural variation: no round-number clusters, no
alphabetical drift, appointment times off the hour where a real book would be.

---

## 4. Build order

| # | Task | Depends on |
|---|---|---|
| 1 | Seed script skeleton, tenant + safety settings, teardown command | — |
| 2 | Verify in prod that the tenant is excluded from the automations cron | 1 |
| 3 | Users, subscription, procedure types | 1 |
| 4 | 50 patients | 3 |
| 5 | Six months of history solved to the targets, with assertions | 4 |
| 6 | Expenses | 3 |
| 7 | Today plus 15 forward days | 4 |
| 8 | Prontuários, face diagrams, antes/depois for 6 patients | 4 |
| 9 | Full-app verification pass against every target number | 5–8 |

Task 2 is a gate. Nothing else runs until the cron demonstrably skips this tenant.

---

## 5. Verification

The script ends by re-reading through the same queries the UI uses and asserting:

- `getQuickStats` → 23 procedures, R$ 34.200
- `getRevenueOverview` → received 34.200, pending 7.800, **overdue 0**,
  expenses 8.400, net 25.800, six-month series exact
- no day in the next 15 (excluding Sundays) with fewer than 3 appointments
- zero WhatsApp automations and zero credentials on the tenant
- every patient phone matches `(11) 90000-0` and every email ends `@example.com`

A drifting seed fails the run instead of producing a screenshot with wrong numbers.

## 6. Re-running and teardown

**Re-runnable by design.** All dates are relative to the run date, so the month
boundary does not stale the data. Today is the 31st: seed on the day of the shoot,
or re-run before it, and the dashboard is correct again.

Idempotent on the tenant id: a re-run wipes and rebuilds that tenant only.
Teardown is a single command that deletes the tenant and everything keyed to it.
