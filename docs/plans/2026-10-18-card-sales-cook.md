# Card Sales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Card payments settle the patient side at once and create a repasse schedule per maquininha; a daily job posts net repasses to the ledger; reports show gross, fees and net.

**Architecture:** Card is a payment attribute, not a charge type. A new `card_payments` row groups one or more `payment_records` (one card transaction), freezes the maquininha rate, and owns `card_repasses`. Card payments write no `cash_movements` at payment time; each repasse writes one net inflow when it is posted (immediately if due, otherwise by the cron). Pure schedule math lives in one shared lib used by server and dialog.

**Tech Stack:** Next.js (repo version, read `node_modules/next/dist/docs/` before routes), Drizzle ORM on Postgres (`floraclin` schema), zod, React Query, vitest with `@/tests/mocks/drizzle-tx`.

**Spec:** `docs/superpowers/specs/2026-10-18-card-sales-design.md`

## Global Constraints

- All paths below are relative to `web/` unless they start with `docs/`.
- Dates: follow `AGENTS.md`. Calendar days are `YYYY-MM-DD` BR days; use `brToday`, `toBrYmd`, `parseBrDate`, `startOfBrDay`, `endOfBrDay` from `@/lib/dates`. Never `new Date(ymd)` bare, never `.toISOString().split('T')[0]`.
- Every new table has `tenant_id` and every query filters by it.
- `cash_movements` is append-only. Corrections = new counter row + `reversedByMovementId` on the original (pattern: `src/db/queries/expenses.ts:370-391`).
- No backward-compat paths: card methods must never write a `cash_movements` inflow at payment time anywhere.
- Comments: default none; only non-obvious constraints. Never use em dashes in code, comments, copy, or commit messages.
- Before writing or changing any test, load the `test-audit` skill and pass its authoring gate.
- Run checks from `web/`: `pnpm vitest run <path>`, `pnpm typecheck`, `pnpm lint`.
- Commit messages: short imperative sentence, no Claude mention, no co-author line.
- User-facing copy is Brazilian Portuguese; exact strings from this plan are fixed.

## Review Focus

1. Bulk card pay across installments of different patients: must be refused (`CARD_BULK_MULTIPLE_PATIENTS`), since a card transaction is one patient. Test in Task 5.
2. Reversing one payment record of a bulk card payment: reverses every record of that card payment and cancels its pending repasses once, not N times. Test in Task 5.
3. Backdated card payment (paidAt 60 days ago, per-parcela): repasses already due are posted immediately with their own dates, the rest stay pending. Test in Task 4.
4. Cron run twice in one day, or after missed days: each repasse posts exactly once. Test in Task 4 (`postDueRepassesTx`).
5. Maquininha rate edited after a sale: existing card payments and repasses keep the frozen rate. Test in Task 4.
6. Payment fails after the approval or charge already committed (any error, not only `BusinessError`): response is success with `paymentError`, charge stays pending, error is reported. Tests in Tasks 5 and 8.
7. Two successive adjustments of a received repasse: exactly one active inflow remains, and the repasse points at it. Test in Task 4.
8. A card plan created at 22:00 BRT on a UTC host is due today in BR, not tomorrow. Test in Task 5.

## Plan review outcome (adversarial, Codex)

Applied: per-tenant cron transactions; tenant required on every domain function; lock order card payment then repasses, installments then entries; atomic claim when posting; pointer rotation and original-date counters on adjustment; bounded ledger descriptions; net/fee split per spec; strict card payload invariants; BR-safe due dates; dashboard and revenue chart consume fees; `{{forma_pagamento}}` shows parcelas; bulk preview from real quotes; Task 4 owns the terminal-terms read. Not applied: rewriting revenue around payment records (out of scope: card fees follow the same basis as the existing `totalReceived`); real-Postgres concurrency tests (the repo tests with mocks; DB constraints and atomic claims carry the guarantee).

---

## Group A (parallel)

### Task 1: Schema and migration

**Files:**
- Modify: `src/db/schema.ts` (financial section ~397-470, relations ~1346-1400)
- Create: `src/db/migrations/0041_card_sales.sql`

**Interfaces (Produces):**

```ts
export const cardTerminals = floraclinSchema.table('card_terminals', {
  id, tenantId (FK tenants),
  name: varchar(100) notNull,
  isDefault: boolean notNull default false,
  debitRate: decimal(5,2) notNull,            // percent
  debitPayoutDays: integer notNull default 1, // business days
  creditRates: jsonb.$type<string[]>() notNull, // 12 percent strings, index 0 = 1x
  creditPayoutMode: varchar(20) notNull,      // 'per_installment' | 'lump_sum'
  creditLumpSumDays: integer notNull default 1, // business days, used when lump_sum
  createdAt, updatedAt, deletedAt,
})
// unique partial index: (tenant_id) WHERE is_default AND deleted_at IS NULL

export const cardPayments = floraclinSchema.table('card_payments', {
  id, tenantId, cardTerminalId (FK card_terminals), patientId (FK patients),
  method: varchar(20) notNull,          // 'credit_card' | 'debit_card'
  installmentCount: integer notNull,    // card parcelas, 1 for debit
  rate: decimal(5,2) notNull,           // frozen percent
  payoutMode: varchar(20) notNull,      // 'per_installment' | 'lump_sum' | 'debit', frozen
  grossAmount, feeAmount, netAmount: decimal(10,2) notNull, // immutable sale values; adjusted totals come from repasses
  description: varchar(255) notNull,    // snapshot for ledger lines
  paidAt: timestamptz notNull,
  reversedAt: timestamptz, reversedBy: uuid FK users,
  createdBy: uuid FK users notNull, createdAt,
})

export const cardRepasses = floraclinSchema.table('card_repasses', {
  id, tenantId, cardPaymentId (FK card_payments),
  sequence: integer notNull,            // 1..N
  expectedDate: date notNull,
  grossAmount, feeAmount, netAmount: decimal(10,2) notNull,
  status: varchar(20) notNull default 'pending', // 'pending' | 'received' | 'cancelled'
  receivedAt: timestamptz, cashMovementId: uuid FK cash_movements, // the currently active inflow
  createdAt, updatedAt,
})
// index (tenant_id, status, expected_date); unique (card_payment_id, sequence)
// CHECK: (status = 'received') = (cash_movement_id IS NOT NULL)
```

Also add columns:
- `financialEntries.paymentMethod: varchar('payment_method', 20)` (planned method, nullable) and `financialEntries.cardInstallmentCount: integer('card_installment_count')` (nullable).
- `paymentRecords.cardPaymentId: uuid('card_payment_id')` FK card_payments, nullable, indexed.
- `cashMovements.cardRepasseId: uuid('card_repasse_id')` nullable, FK card_repasses. Set on the repasse inflow and on its counter rows. Partial unique index `(card_repasse_id) WHERE type = 'inflow' AND reversed_by_movement_id IS NULL` so one repasse never has two active inflows.

Relations: cardPayments has many cardRepasses and paymentRecords; one cardTerminal.

- [ ] **Step 1:** Add the tables, columns, indexes and relations to `schema.ts`.
- [ ] **Step 2:** Write `0041_card_sales.sql` in the style of `0040_lifecycle_attribution.sql` (`IF NOT EXISTS`, `--> statement-breakpoint`, `ENABLE ROW LEVEL SECURITY` on the three new tables), with CHECK constraints: `card_payments.method IN ('credit_card','debit_card')`, `card_payments.payout_mode IN ('per_installment','lump_sum','debit')`, `card_terminals.credit_payout_mode IN ('per_installment','lump_sum')`, `card_repasses.status IN ('pending','received','cancelled')`, `card_payments.installment_count BETWEEN 1 AND 12`, `jsonb_array_length(credit_rates) = 12`.
- [ ] **Step 3:** `pnpm typecheck` passes.
- [ ] **Step 4:** Commit `Add card terminal, card payment and repasse tables`.

### Task 2: Repasse schedule math

**Files:**
- Create: `src/lib/financial/card-repasses.ts`
- Test: `src/lib/financial/__tests__/card-repasses.test.ts`

**Interfaces (Produces):**

```ts
export type CardMethod = 'credit_card' | 'debit_card'
export type CardPayoutMode = 'per_installment' | 'lump_sum' | 'debit'
export interface CardTerminalTerms {
  debitRate: number; debitPayoutDays: number
  creditRates: number[]            // length 12
  creditPayoutMode: 'per_installment' | 'lump_sum'; creditLumpSumDays: number
}
export interface PlannedRepasse { sequence: number; expectedDate: string; grossAmount: number; feeAmount: number; netAmount: number }
export interface CardSchedule { rate: number; payoutMode: CardPayoutMode; grossAmount: number; feeAmount: number; netAmount: number; repasses: PlannedRepasse[] }

export function addBusinessDays(ymd: string, days: number): string
export function buildCardSchedule(input: { gross: number; method: CardMethod; installmentCount: number; terms: CardTerminalTerms; paymentYmd: string }): CardSchedule
export function describeCardSchedule(schedule: CardSchedule): string
```

Rules (from spec):
- Rate: debit uses `debitRate` and forces `installmentCount = 1`; credit uses `creditRates[installmentCount - 1]`.
- `feeAmount = round2(gross * rate / 100)`, `netAmount = gross - feeAmount` (cents arithmetic).
- Payout: debit → one repasse at `addBusinessDays(paymentYmd, debitPayoutDays)`, mode `'debit'`. Credit lump_sum → one repasse at `addBusinessDays(paymentYmd, creditLumpSumDays)`. Credit per_installment → N repasses at `paymentYmd + 30*k` calendar days (k = 1..N), BR-safe (add days to the `YYYY-MM-DD` without host TZ).
- Split (spec): each repasse gets `floor(total/N)` cents of net and of fee; the last repasse takes the remainder of each; `gross = net + fee` per row. Sums equal the totals exactly.
- Debit always yields `installmentCount = 1` in the returned schedule; callers persist the schedule's count, never the input.
- Per-installment dates use `shiftBrYmd(paymentYmd, 30 * k)` from `@/lib/dates`.
- `addBusinessDays(ymd, 0)` returns `ymd` unchanged (even on weekends). For `days >= 1` skip Saturday and Sunday.
- `describeCardSchedule`: N>1 → `6 repasses de R$ 455,05, a partir de 17/11/2026` (use the first repasse's net); one repasse → `1 repasse de R$ 2.655,30 em 19/10/2026`, with ` (antecipado)` appended when `payoutMode === 'lump_sum'`. Use `formatCurrency` from `@/lib/utils`.

- [ ] **Step 1: Write the failing tests** with these cases:
  - `buildCardSchedule({gross: 3000, method:'credit_card', installmentCount:6, terms:{creditRates[5]=8.99, per_installment}, paymentYmd:'2026-10-18'})` → fee 269.70, net 2730.30, 6 repasses, first `2026-11-17` net 455.05, sum of nets 2730.30.
  - Same with lump_sum, rate 11.49, `creditLumpSumDays:1` → fee 344.70, net 2655.30, one repasse on `2026-10-19` (2026-10-18 is a Sunday).
  - Remainder: gross 100, rate 0, 3x → nets 33.33, 33.33, 33.34.
  - Remainder with fee: gross 100, rate 2, 3x → fee 2.00, nets 32.66, 32.66, 32.68; fees 0.66, 0.66, 0.68; each gross = net + fee.
  - Debit with `installmentCount: 6` input → treated as 1, rate = debitRate.
  - `addBusinessDays('2026-10-16', 1)` (Friday) → `'2026-10-19'`; `addBusinessDays('2026-10-18', 0)` → `'2026-10-18'`.
  - `describeCardSchedule` for both shapes returns the exact strings above.
- [ ] **Step 2:** Run `pnpm vitest run src/lib/financial/__tests__/card-repasses.test.ts`, expect FAIL (module missing).
- [ ] **Step 3:** Implement. Pure functions, no DB, no `Date` from host TZ (use date-fns `addDays`/`parseISO`-free string math or `parseBrDate` + `toBrYmd`).
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `Compute card repasse schedules`.

## Group B (depends on A, parallel)

### Task 3: Maquininha settings and shared card fields

**Files:**
- Create: `src/db/queries/card-terminals.ts`, `src/validations/card-terminals.ts`
- Create: `src/app/api/financial/card-terminals/route.ts` (GET, POST), `src/app/api/financial/card-terminals/[id]/route.ts` (PATCH, DELETE)
- Create: `src/hooks/queries/use-card-terminals.ts` (query + create/update/delete mutations)
- Create: `src/components/financial/settings/card-terminals-manager.tsx`
- Create: `src/components/financial/card-payment-fields.tsx`
- Modify: `src/app/(platform)/configuracoes/settings-page-client.tsx:506-510` (mount manager after `ExpenseCategoriesManager`)
- Tests: `src/db/queries/__tests__/card-terminals.test.ts`, `src/components/financial/__tests__/card-payment-fields.test.tsx`, route test under `src/app/api/financial/card-terminals/__tests__/route.test.ts`

**Interfaces:**
- Consumes: Task 1 `cardTerminals`; Task 2 `buildCardSchedule`, `describeCardSchedule`, `CardTerminalTerms`. (Task 4 owns the server-side terms read; this task does not depend on Task 4.)
- Produces:

```ts
// queries
export async function listCardTerminals(tenantId: string): Promise<CardTerminalRow[]> // not deleted, default first, then name
export async function createCardTerminal(tenantId: string, userId: string, data: CardTerminalInput)
export async function updateCardTerminal(tenantId: string, userId: string, id: string, data: CardTerminalInput)
export async function deleteCardTerminal(tenantId: string, userId: string, id: string) // soft delete
// validation
export const cardTerminalSchema // name 1..100, isDefault, debitRate 0..100 (2 decimals), debitPayoutDays int 0..60, creditRates array length 12 of 0..100, creditPayoutMode enum, creditLumpSumDays int 0..60
export type CardTerminalInput
// UI
export interface CardPaymentValue { terminalId: string | null; installmentCount: number }
export function CardPaymentFields(props: { method: 'credit_card' | 'debit_card'; gross: number; paymentYmd: string; value: CardPaymentValue; onChange: (v: CardPaymentValue) => void; lockInstallmentCount?: boolean; disabled?: boolean }): JSX.Element
```

Behavior:
- Setting `isDefault` on one terminal clears it on the others in the same transaction. The first terminal created is default. Deleting the default promotes none (the dialog then has no preselection).
- Write roles: `requireWrite('owner')`, like financial settings. GET: `getAuthContext()`.
- Audit log on create/update/delete via `createAuditLog`, entityType `'card_terminal'`.
- Manager UI follows the approved mockup: section title "Maquininhas"; list rows "Stone [Padrão] · Crédito por parcela (D+30, D+60...) · Débito D+1" or "Crédito em valor único, D+1"; "+ Adicionar maquininha"; edit dialog with "Nome", "Débito" (Taxa (%), Repasse em (dias úteis)), "Crédito: taxa por número de parcelas (%)" grid 1x..12x, "Como o crédito é repassado" radio: "Por parcela: uma a cada 30 dias (D+30, D+60...)" / "Valor único (antecipação automática) em D+[n] dias úteis", and a "Padrão" switch. Match `ExpenseCategoriesManager` styling.
- `CardPaymentFields`: "Maquininha" select (preselects the default when `value.terminalId` is null and a default exists, by calling `onChange`), "Parcelas no cartão" select 1x..12x shown only for credit (disabled when `lockInstallmentCount`), and the summary box (summary B):
  ```
  Valor da venda              R$ 3.000,00
  Taxa (8,99%)              − R$ 269,70     (lump_sum: "Taxa com antecipação (11,49%)")
  Você recebe                 R$ 2.730,30
  <describeCardSchedule(...)>
  ```
  When there are no terminals, show "Cadastre uma maquininha em Configurações › Financeiro." and render no summary.

- [ ] **Step 1:** Failing tests: query test asserts `isDefault` clearing and tenant filter on delete; route test asserts 400 on `creditRates` length 11 and 403 path via `requireWrite`; component test renders the summary strings above for the two fixtures in Task 2 and hides "Parcelas no cartão" for debit.
- [ ] **Step 2:** Run them, expect FAIL.
- [ ] **Step 3:** Implement queries, schema, routes, hook, manager, fields; mount manager.
- [ ] **Step 4:** Tests pass; `pnpm typecheck`.
- [ ] **Step 5:** Commit `Add maquininha settings`.

### Task 4: Card payment and repasse core

**Files:**
- Create: `src/db/queries/card-payments.ts`
- Test: `src/db/queries/__tests__/card-payments.test.ts`

**Interfaces:**
- Consumes: Task 1 tables; Task 2 `buildCardSchedule`, `CardTerminalTerms`.
- Produces:

```ts
export interface CardPaymentRequest { terminalId: string; method: 'credit_card' | 'debit_card'; installmentCount: number }
export async function getCardTerminalTerms(tx: typeof db, tenantId: string, terminalId: string): Promise<{ id: string; name: string; terms: CardTerminalTerms }> // BusinessError('CARD_TERMINAL_NOT_FOUND', 'Maquininha não encontrada') if missing/deleted/other tenant
export async function createCardPaymentTx(tx: typeof db, tenantId: string, userId: string, input: CardPaymentRequest & { gross: number; paidAt: Date; patientId: string; description: string }): Promise<{ cardPaymentId: string }>
export async function postDueRepassesTx(tx: typeof db, tenantId: string, opts: { todayYmd: string; cardPaymentId?: string }): Promise<number> // count posted
export async function listTenantsWithDueRepasses(todayYmd: string): Promise<string[]> // the only cross-tenant read; used by the cron
export async function cancelCardPaymentTx(tx: typeof db, tenantId: string, userId: string, cardPaymentId: string): Promise<{ cancelledRepasses: number; receivedRepasses: number }>
export async function adjustCardRepasse(tenantId: string, userId: string, repasseId: string, data: { netAmount: number; expectedDate: string }): Promise<void>
export async function listCardRepasses(tenantId: string, filters: { dateFrom: string; dateTo: string; terminalId?: string; status?: 'pending' | 'received' | 'cancelled'; page: number; limit: number }): Promise<{ rows: CardRepasseListRow[]; total: number; pendingNetTotal: number }>
export async function getCardPaymentSummaries(tx: typeof db, tenantId: string, cardPaymentIds: string[]): Promise<Map<string, { terminalName: string; method: string; installmentCount: number; pendingRepasses: number; receivedRepasses: number; linkedPaymentCount: number }>>
export async function sumCardFeesForEntries(tenantId: string, entryConditions: SQL[]): Promise<number> // fees of non-cancelled repasses of non-reversed card payments whose payment records belong to entries matching the same conditions getRevenueOverview uses for totalReceived
export function repasseLedgerDescription(prefix: string, rest: string): string // `${prefix}${rest}` truncated to 255 chars with '…'
```

Lock order everywhere: `card_payments` row first, then its `card_repasses` rows (ordered by sequence).

Behavior:
- `createCardPaymentTx`: loads terms via `getCardTerminalTerms`, builds the schedule with `paymentYmd = toBrYmd(paidAt)`, inserts `card_payments` (frozen rate, payoutMode, schedule's installmentCount and totals) and `card_repasses`, then calls `postDueRepassesTx(tx, tenantId, { todayYmd: brToday(), cardPaymentId })`.
- `postDueRepassesTx`: select `tenant_id = $1 AND status = 'pending' AND expected_date <= $today [AND card_payment_id = $2]` repasses of non-reversed card payments, `FOR UPDATE SKIP LOCKED`, ordered by id. For each: insert the `cash_movements` inflow `{ amount: net, paymentMethod: method, movementDate: parseBrDate(expectedDate, '12:00:00'), patientId, recordedBy: card_payments.createdBy, cardRepasseId, description: repasseLedgerDescription('Repasse <terminal> <seq>/<n>: ', description) }`, then one `UPDATE ... SET status = 'received', received_at = now(), cash_movement_id = $id WHERE id = $r AND status = 'pending'` (status and pointer in one statement, so the CHECK holds). Rows locked by a concurrent reversal are skipped and picked up next run. Everything runs in the caller's transaction.
- `cancelCardPaymentTx`: locks the card payment then its repasses, sets `reversedAt/reversedBy`, sets pending repasses to `cancelled`, returns counts. Writes no cash movement.
- `adjustCardRepasse` (own transaction, same lock order): `netAmount` > 0 and ≤ gross, else `BusinessError('INVALID_REPASSE_AMOUNT', 'O valor líquido deve ser maior que zero e no máximo o valor bruto')`. Card payment reversed or repasse cancelled → `BusinessError('REPASSE_CANCELLED', 'Repasse cancelado não pode ser ajustado')`. Pending: update `netAmount`, `feeAmount = gross - net`, `expectedDate`; if new date ≤ today, post it now via `postDueRepassesTx`. Received: `expectedDate` must be ≤ today (`BusinessError('REPASSE_DATE_IN_FUTURE', 'Repasse já recebido não pode ter data futura')`); insert an outflow counter dated at the original movement's `movementDate` (`paymentMethod: null`, `cardRepasseId`, description via `repasseLedgerDescription('Ajuste de repasse: ', ...)`), set the original movement's `reversedByMovementId`, insert a new inflow with the new net and date, and set `card_repasses.cashMovementId` to the new inflow. Audit log entityType `'card_repasse'`.
- `card_payments` totals are never rewritten. Adjusted fee/net for reports and lists come from summing repasses.

- [ ] **Step 1: Failing tests** (mock pattern from `financial-payment.test.ts`):
  - `createCardPaymentTx` inserts one card payment with rate 8.99 frozen and 6 repasses; zero cash movements when all dates are future.
  - Backdated (Review Focus 3): paidAt 2026-08-19, per-parcela 6x, today 2026-10-18 → repasses 1 and 2 posted (2 inflows with movementDate at their own BR days), 4 pending.
  - Rate frozen (Review Focus 5): after terms change, existing rows unchanged (assert no update to `card_payments`/`card_repasses` on terminal update; covered by the query only reading terms at creation).
  - `postDueRepassesTx` twice (Review Focus 4) → second call posts 0 (only `pending` rows selected; status updated).
  - `adjustCardRepasse` on a received repasse writes outflow (dated at the original movement date) + new inflow and sets `reversedByMovementId` on the original.
  - Two successive adjustments (Review Focus 7): the second reverses the first replacement (the pointer rotated), not the original.
  - `repasseLedgerDescription` with a 100-char terminal name and a 255-char description returns 255 chars.
  - `postDueRepassesTx` only touches rows of the given tenant (assert the tenant predicate in the claim).
  - `cancelCardPaymentTx` cancels only pending repasses and returns `{ cancelledRepasses: 4, receivedRepasses: 2 }`.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `Create card payments and post repasses`.

## Group C (depends on B, parallel)

### Task 5: Payment paths in financial queries

**Files:**
- Modify: `src/db/queries/financial.ts` (`createFinancialEntry` 51-114, `recordPayment` 597-757, `reversePayment` 761-881, `bulkPayInstallments` 885-1057, `getFinancialEntry` 1696+, `getRevenueOverview` 1792+)
- Modify: `src/validations/financial.ts`
- Modify: `src/app/api/financial/installments/[id]/pay/route.ts`, `src/app/api/financial/bulk/pay/route.ts`, `src/app/api/financial/route.ts` (POST)
- Modify: `src/hooks/mutations/use-financial-mutations.ts` (payload types for pay, bulk pay, create entry)
- Tests: extend `src/db/queries/__tests__/financial-payment.test.ts`, `financial-bulk-pay.test.ts`, `financial-reverse.test.ts`, `financial-entry.test.ts`, and the route tests under `src/app/api/financial/**/__tests__`

**Interfaces:**
- Consumes: Task 4 `createCardPaymentTx`, `cancelCardPaymentTx`, `getCardPaymentSummaries`, `sumCardFeesForEntries`, `CardPaymentRequest`.
- Produces:

```ts
// validations
const cardPaymentField = z.object({ terminalId: z.string().uuid(), installmentCount: z.number().int().min(1).max(12) }).optional()
recordPaymentSchema   += { card: cardPaymentField }   // refine: required iff paymentMethod is credit_card|debit_card, message 'Selecione a maquininha'
bulkPaySchema         += { card: cardPaymentField }   // same refine
createFinancialEntrySchema += { paymentMethod: z.enum(paymentMethods).optional(), card: cardPaymentField }
  // refines: card present iff paymentMethod is a card method ('Selecione a maquininha');
  // card present => installmentCount === 1 ('Pagamento em cartão gera uma única parcela')
// The stored financial_entries.card_installment_count is derived (card.installmentCount, 1 for debit); it is not a payload field.
// createFinancialEntry's internal input type (not the HTTP schema) also accepts cardInstallmentCount for the finalize path.
// queries
createFinancialEntry(...) returns entry & { installmentIds: string[] }
getFinancialEntry: each payment record gains `card: { terminalName, method, installmentCount, pendingRepasses, receivedRepasses, linkedPaymentCount } | null`; entry gains `paymentMethod`, `cardInstallmentCount`
getRevenueOverview: summary gains `totalCardFees: number` (via `sumCardFeesForEntries` with the same entry conditions, including the practitioner filter, that `totalReceived` uses); `netProfit = totalReceived - totalExpenses - totalCardFees`
```

Behavior:
- `createFinancialEntry`: default due dates become `shiftBrYmd(brToday(), i * 30)` instead of `toLocalYmd(addDays(new Date(), ...))` (AGENTS.md; Review Focus 8). Persist `paymentMethod` and `cardInstallmentCount`.
- `recordPayment` with a card method: after inserting the payment record, call `createCardPaymentTx` with `gross = data.amount`, `paidAt`, `patientId`, `description = entry.description`, then set `paymentRecords.cardPaymentId`. Do not insert the `cash_movements` inflow. Non-card methods unchanged.
- `bulkPayInstallments` with a card method: all locked installments must share one `patientId`, else `BusinessError('CARD_BULK_MULTIPLE_PATIENTS', 'Pagamento em cartão deve ser de um único paciente')` (Review Focus 1). Run the loop without inflows, collect record ids and amounts, then one `createCardPaymentTx` for the sum (description: the entry description when one entry, else `Pagamento de N parcelas`) and update those records' `cardPaymentId`.
- `reversePayment`:
  - Non-card: after inserting the outflow, set `reversedByMovementId` on the inflow whose `paymentRecordId = pr.id` (spec: fix existing gap).
  - Card (`pr.cardPaymentId` set): reverse every non-reversed payment record of that card payment. Lock order: their installments ordered by id, then their financial entries ordered by id (same as `bulkPayInstallments`), then `cancelCardPaymentTx` (card payment, then repasses). Run the replay per installment as today, write no outflow, cancel once (Review Focus 2). Return `{ success: true, card: { cancelledRepasses, receivedRepasses } }`.
- Routes pass `card` through; `POST /api/financial` with `card` creates the entry (1 installment) and then calls `recordPayment` for `installmentIds[0]` with `expectedTotalDue = totalAmount`. Any error from that payment (not only `BusinessError`) returns 201 with the entry and `paymentError` (BusinessError message, or `Não foi possível registrar o pagamento. A cobrança ficou pendente.`), reported via `reportSideEffectFailure` when it is not a BusinessError (Review Focus 6).

- [ ] **Step 1: Failing tests:**
  - recordPayment credit 6x: no `cashMovements` insert; `createCardPaymentTx` called with gross = amount; record updated with cardPaymentId.
  - recordPayment credit without `card` → schema refine error `Selecione a maquininha`.
  - bulk pay card across two patients → `CARD_BULK_MULTIPLE_PATIENTS`; same patient, 3 installments → one `createCardPaymentTx` with the sum.
  - reverse card payment linked to 3 records → 3 records reversed, `cancelCardPaymentTx` called once, no outflow.
  - reverse pix payment → original inflow gets `reversedByMovementId` = new outflow id.
  - getRevenueOverview: `netProfit` subtracts `totalCardFees`.
  - financial POST with card → entry + payment; payment BusinessError → 201 with `paymentError`; payment throws a plain `Error` → 201 with the generic `paymentError` and `reportSideEffectFailure` called.
  - createFinancialEntry with system time `2026-10-19T01:00:00Z` (22:00 BRT on 18/10) → first due date `2026-10-18`.
  - schema: credit method without `card` fails; `card` with `installmentCount: 3` charge fails.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** All financial tests pass: `pnpm vitest run src/db/queries/__tests__/financial src/app/api/financial`.
- [ ] **Step 5:** Commit `Route card payments through repasse schedules`.

### Task 6: Repasse cron and repasse API

**Files:**
- Create: `src/app/api/cron/card-repasses/route.ts`
- Modify: `vercel.json` (add `{ "path": "/api/cron/card-repasses", "schedule": "0 9 * * *" }`)
- Create: `src/app/api/financial/card-repasses/route.ts` (GET list), `src/app/api/financial/card-repasses/[id]/route.ts` (PATCH adjust)
- Create: `src/validations/card-repasses.ts`
- Tests: `src/app/api/cron/card-repasses/__tests__/route.test.ts`, `src/app/api/financial/card-repasses/__tests__/route.test.ts`

**Interfaces:**
- Consumes: Task 4 `postDueRepassesTx`, `listCardRepasses`, `adjustCardRepasse`.
- Produces: `GET /api/financial/card-repasses?dateFrom&dateTo&terminalId&status&page&limit` → `{ data: rows, total, pendingNetTotal }`; `PATCH /api/financial/card-repasses/[id]` body `{ netAmount: number, expectedDate: 'YYYY-MM-DD' }`.

Behavior:
- Cron mirrors `src/app/api/cron/subscription-expiry/route.ts`: `CRON_SECRET` bearer check, `withCronMonitor('card-repasses', '0 9 * * *', ...)`. It calls `listTenantsWithDueRepasses(brToday())`, then for each tenant runs `postDueRepassesTx(tx, tenantId, { todayYmd })` in its own `withTransaction`. A failing tenant is reported with `reportSideEffectFailure` (`@/lib/observability`) and the loop continues. Returns `{ ok: true, posted, failedTenants }`. `0 9 * * *` UTC is 06:00 `America/Sao_Paulo`: put that in one comment.
- List: `getAuthContext()`; adjust: `requireWrite('owner', 'financial')`; BusinessError → 409 `{ error, code }` like the pay route.
- `expectedDate` validation uses `isValidYmd` from `@/lib/dates` (rejects `2026-02-31`).

- [ ] **Step 1:** Failing tests: cron 401 without secret; cron runs one transaction per tenant with `brToday()`; one tenant throwing does not stop the next; PATCH 400 on `2026-02-31`; PATCH 409 passes the BusinessError code.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `Post card repasses daily`.

## Group D (depends on C, parallel)

### Task 7: Payment dialogs and Nova cobrança

**Files:**
- Modify: `src/components/financial/partial-payment-dialog.tsx`, `src/components/financial/bulk-action-bar.tsx`, `src/components/financial/installment-table.tsx` (reads planned method and card summaries from the `getFinancialEntry` data it already fetches), `src/components/financial/payment-form.tsx`
- Tests: `src/components/financial/__tests__/` (extend existing dialog/bulk/payment-form tests)

**Interfaces:**
- Consumes: Task 3 `CardPaymentFields`, `CardPaymentValue`; Task 5 payload types and `getFinancialEntry` card fields.
- Produces: `PartialPaymentDialog` props gain `defaultPaymentMethod?: PaymentMethod` and `defaultCardInstallmentCount?: number`.

Behavior:
- Partial payment dialog: when method is credit/debit, render `CardPaymentFields` with `gross = parsedAmount`, `paymentYmd` from the chosen date or `brToday()`; send `card`. Disable confirm until a terminal is chosen. Prefill method and parcelas from the entry's planned method.
- Bulk pay dialog: same fields; gross = sum of `totalDue` from the existing per-installment quote hook (`useInstallmentQuote`, via `useQueries` or one hook per row) for the chosen date, since the server prices each installment at that date; show "Calculando..." until all quotes resolve and keep confirm disabled. Surface `CARD_BULK_MULTIPLE_PATIENTS` as a toast.
- Installment table: payment record rows show "Cartão de crédito · Stone · 6x" when `card` is set. The reverse dialog, for a card payment, shows (exact copy, counts from `card`): `{pendingRepasses} repasses futuros serão cancelados. {receivedRepasses} repasses já recebidos ficam no extrato. Estorne o valor ao paciente na maquininha.` and, when `linkedPaymentCount > 1`, `Este pagamento em cartão cobre {linkedPaymentCount} parcelas. Todas serão estornadas.`
- Nova cobrança (`payment-form.tsx`): add "Método de Pagamento" select (`PAYMENT_METHOD_ITEMS`). For a card method: force and lock "Parcelas" to 1, render `CardPaymentFields` (credit parcelas editable), send `paymentMethod`, `cardInstallmentCount`, `card`. Non-card: send `paymentMethod` only. On `paymentError` in the response, toast it and say the charge was created as pending.

- [ ] **Step 1:** Failing tests: dialog sends `card` for credit and omits it for pix; reverse dialog shows the exact card copy; payment-form locks Parcelas to 1 for a card.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `Record card payments from the payment dialogs`.

### Task 8: Card plans at approval

**Files:**
- Modify: `src/lib/encounter-finalize.ts` (charge creation ~175-200), `src/app/api/encounters/[id]/finalize/route.ts`, `src/components/procedures/procedure-approval.tsx`, `src/components/procedures/planning/financial-plan-field.tsx`, `src/lib/contract-interpolation.ts`
- Tests: existing tests for `encounter-finalize` and the finalize route (find with `rg -l encounter-finalize src --glob '*.test.*'`), `procedure-approval` test if present

**Interfaces:**
- Consumes: Task 3 `CardPaymentFields`; Task 5 `createFinancialEntry` return `installmentIds` and `recordPayment` with `card`.
- Produces: finalize request body gains optional `cardPayment: { terminalId: string }`; response gains `paymentError?: string`.

Behavior:
- `finalizeEncounter`: when `financialPlan.paymentMethod` is `credit_card`/`debit_card`, call `createFinancialEntry` with `installmentCount: 1`, `paymentMethod`, `cardInstallmentCount: plan.installmentCount` (1 for debit). Otherwise pass `paymentMethod` and keep the plan's installment count. Return the first installment id.
- Finalize route schema: `paymentMethod` becomes the shared enum (`pix`, `credit_card`, `debit_card`, `cash`, `transfer`), `installmentCount` 1..12, debit requires 1; `cardPayment` allowed only when the method is a card. Validation runs before `finalizeEncounter`, so a bad plan never commits.
- Finalize route: after `finalizeEncounter` succeeds and `cardPayment` is present, call `recordPayment` for that installment with method/parcelas from the plan, `expectedTotalDue = totalAmount`. Any error from that payment returns success with `paymentError` (BusinessError message or `Não foi possível registrar o pagamento. A cobrança ficou pendente.`), reported via `reportSideEffectFailure` when not a BusinessError. This runs as the finalize caller (`owner`/`practitioner`), deliberately not through the pay route's role list.
- Approval UI: when the plan method is a card, show a checkbox "Pagamento no cartão feito agora"; when checked, render `CardPaymentFields` with `lockInstallmentCount` and send `cardPayment`. On `paymentError`, toast it and say the charge stays pending.
- Plan field: when "Cartão de débito" is chosen, force installment count to 1 and disable that select.
- Contract text: `{{forma_pagamento}}` for `credit_card` with installmentCount > 1 renders `Cartão de crédito em 6x` (spec goal 8). Other methods keep the plain label. `{{parcelas}}` unchanged.

- [ ] **Step 1:** Failing tests: finalize with credit 6x plan creates entry with `installmentCount: 1` and `cardInstallmentCount: 6`; pix 3x plan unchanged except `paymentMethod`; route with `cardPayment` calls `recordPayment` with `card`; route returns `paymentError` on BusinessError and on a plain Error; route 400 for debit with 3 installments and for `cardPayment` with a pix plan, without calling `finalizeEncounter`; `buildContractData` credit 6x → `formaPagamento === 'Cartão de crédito em 6x'`; approval UI sends `cardPayment` only when the checkbox is checked.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `Settle card plans at approval`.

### Task 9: Repasses tab and fees in overview

**Files:**
- Modify: `src/app/(platform)/financeiro/financeiro-page-client.tsx` (TABS + lazy view)
- Create: `src/components/financial/card-repasses/card-repasses-view.tsx`, `src/components/financial/card-repasses/adjust-repasse-dialog.tsx`, `src/hooks/queries/use-card-repasses.ts` (list query + adjust mutation)
- Modify: `src/components/financial/revenue-chart.tsx` (show "Taxas de cartão"; use `summary.netProfit` instead of recomputing net at ~93-96)
- Modify: `src/db/queries/dashboard.ts` (~217-260: expose `totalCardFees` from `getRevenueOverview` in `QuickStats`), `src/components/dashboard/financial-summary.tsx` (~28-34: net = revenue - expenses - card fees; show the fee line)
- Tests: `src/components/financial/card-repasses/__tests__/card-repasses-view.test.tsx`, extend `src/db/queries/__tests__/dashboard-quick-stats.test.ts` and the revenue chart / financial summary tests

**Interfaces:**
- Consumes: Task 6 endpoints; Task 5 `summary.totalCardFees`.

Behavior:
- New tab `{ value: 'card-repasses', label: 'Repasses', icon: CreditCardIcon }` placed after "Extrato".
- View: filters (period default current month, maquininha, status); top card "A receber das maquininhas" = `pendingNetTotal`; table columns Data prevista, Maquininha, Paciente, Bruto, Taxa, Líquido, Status (labels "Aguardando repasse", "Recebido", "Cancelado"); row action "Ajustar repasse" (hidden for cancelled).
- Adjust dialog: "Valor líquido (R$)" and "Data"; for a received repasse show `O lançamento anterior no extrato será estornado e um novo será criado.`
- Revenue chart summary: add a "Taxas de cartão" figure next to expenses; display `summary.netProfit`.
- Dashboard financial summary: show "Taxas de cartão" and subtract it from net.

- [ ] **Step 1:** Failing tests: view renders the status labels and the pending total; adjust dialog shows the received-repasse notice; revenue chart with `totalCardFees: 100` shows net reduced by 100; quick stats carry `totalCardFees`.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `Show card repasses in Financeiro`.

## Final

- [ ] `pnpm ci:checks` from the repo root is green.
