# Financial Overhaul Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform FloraClin's basic charge/installment financial module into a full cashflow management system with Art. 354-compliant penalties, expenses, renegotiation, unified ledger, and practitioner P&L.

**Architecture:** Manual-first approach (clinics record payments themselves). Provider integration (Asaas, Stripe) deferred to a future phase — no speculative schema additions. Penalty calculations follow Revezza's proven implementation pattern.

**Tech Stack:** Drizzle ORM, Next.js 16 API routes, React Query, Recharts, Supabase Storage (expense attachments)

---

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Payment processing | Manual now, provider integration in future phase | Gets to market faster; small clinics collect externally anyway |
| Cashflow scope | Full (revenue + expenses) | Owners need "am I making money?" in one screen |
| Fines & interest | Full Art. 354, configurable, settings snapshotted per installment | Brazilian standard; rates frozen at first delinquency for legal correctness |
| Recurring charges | No | HOF clinics charge per procedure, not subscriptions |
| Expense categories | System defaults + custom | Trivial to implement, avoids "I need category X" complaints |
| Expense attachments | Yes (expenses only) | Receipts matter for bookkeeping; charges don't need it |
| Bulk operations | Yes (mark paid + cancel + renegotiate) | End-of-day reconciliation is a real workflow |
| Renegotiation | Yes, supports multi-charge consolidation | HOF procedures are expensive; patients renegotiate often |
| Reporting | Ledger + practitioner P&L | Essential for bookkeeping and commission decisions |
| Revenue attribution | Cash-based for ledger/dashboard, accrual-based for practitioner P&L | Ledger matches bank reality; P&L reflects when value was generated |
| Ledger integrity | Append-only `cash_movements` table | Single source of truth for all financial movements |
| Backdated payments | Full chronological recalculation of Art. 354 allocations | Legally precise; handles out-of-order payment recording |

---

## Architectural Principles (from adversarial review)

### 1. Immutable Ledger
All financial movements are recorded as append-only rows in `cash_movements`. The Extrato tab, dashboard, and all reports derive from this single source. No mutable state is used for ledger projections.

### 2. Concurrency Safety
Payment recording uses row-level locking (`SELECT ... FOR UPDATE`) on the installment row. This prevents concurrent payment recordings from producing corrupt Art. 354 allocations.

### 3. Status Separation
Persisted lifecycle status (pending, paid, cancelled, renegotiated) is stored on the row. Computed view attributes (isOverdue, isPartial) are derived at query/display time from payment state and dates. Filters use both but never confuse them.

### 4. Settings Snapshotting
When an installment first becomes overdue, the current `finePercent`, `fineType`, and `monthlyInterestPercent` are snapshotted onto the installment. Future settings changes affect only new delinquencies, not historical ones.

### 5. Backdated Payment Recalculation
When a payment is recorded with a `paidAt` date earlier than existing payments on the same installment, all payments are recalculated in chronological order. Each payment's Art. 354 allocation is recomputed using the correct interest accrual as of its date. This ensures legal precision for partial payment sequences entered out of order.

### 6. Dual Revenue Attribution
- **Cashflow views** (Extrato, Visao Geral, dashboard): cash-based, attributed on payment date
- **Practitioner P&L**: accrual-based, attributed on procedure date. Shows both "revenue generated" (procedure date) and "revenue collected" (payment date) columns

### 7. Timezone & Overdue Rules
- `dueDate` comparison uses clinic timezone (from tenant settings)
- Grace period is inclusive (due March 1 + 3 days grace = overdue from March 5)
- Interest uses calendar days, 30-day month basis (consistent with Revezza / Art. 406)

---

## 1. Data Model

### New Tables

#### `cash_movements` (append-only ledger)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| tenantId | UUID | FK to tenants |
| type | varchar(20) | 'inflow' or 'outflow' |
| amount | decimal(10,2) | Always positive |
| description | varchar(255) | Human-readable |
| paymentMethod | varchar(20) | pix, credit_card, debit_card, cash, transfer |
| movementDate | timestamp | When the money moved (may differ from recordedAt) |
| recordedAt | timestamp | When staff recorded it |
| paymentRecordId | UUID | Nullable — FK to payment_records (for inflows) |
| expenseInstallmentId | UUID | Nullable — FK to expense_installments (for outflows) |
| patientId | UUID | Nullable — for inflows linked to patient charges |
| expenseCategoryId | UUID | Nullable — for outflows linked to expense categories |
| recordedBy | UUID | FK to users |
| reversedByMovementId | UUID | Nullable — self-ref FK for reversals/corrections |

#### `expenses`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| tenantId | UUID | FK to tenants |
| categoryId | UUID | FK to expense_categories |
| description | varchar(255) | |
| totalAmount | decimal(10,2) | |
| installmentCount | integer | Default 1 |
| status | varchar(20) | pending, paid, cancelled |
| notes | text | |
| createdBy | UUID | FK to users |
| createdAt | timestamp | |
| updatedAt | timestamp | |
| deletedAt | timestamp | Soft delete |

#### `expense_installments`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| expenseId | UUID | FK to expenses |
| installmentNumber | integer | |
| amount | decimal(10,2) | |
| dueDate | date | |
| status | varchar(20) | pending, paid |
| paidAt | timestamp | |
| paymentMethod | varchar(20) | pix, credit_card, debit_card, cash, transfer |
| notes | text | |

Note: When an expense installment is marked as paid, a `cash_movements` row (type: 'outflow') is also created in the same transaction.

#### `expense_categories`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| tenantId | UUID | Nullable — null = system default |
| name | varchar(100) | |
| icon | varchar(50) | Lucide icon name |
| isSystem | boolean | System defaults can't be deleted |
| sortOrder | integer | |
| deletedAt | timestamp | Soft delete |

**System defaults (seeded on tenant creation):**
Aluguel, Materiais/Insumos, Folha de Pagamento, Marketing, Equipamentos, Impostos/Taxas, Servicos Terceirizados, Manutencao, Outros

#### `expense_attachments`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| expenseId | UUID | FK to expenses |
| fileName | varchar(255) | |
| fileUrl | text | Supabase Storage URL |
| fileSize | integer | Bytes |
| mimeType | varchar(100) | |
| uploadedBy | UUID | FK to users |
| createdAt | timestamp | |

#### `payment_records`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| installmentId | UUID | FK to installments |
| amount | decimal(10,2) | Total payment amount |
| paymentMethod | varchar(20) | |
| interestCovered | decimal(10,2) | Art. 354 allocation |
| fineCovered | decimal(10,2) | Art. 354 allocation |
| principalCovered | decimal(10,2) | Art. 354 allocation |
| paidAt | timestamp | When payment was received (may be backdated) |
| recordedAt | timestamp | When staff recorded it |
| recordedBy | UUID | FK to users |
| notes | text | |

Note: When a payment record is created, a `cash_movements` row (type: 'inflow') is also created in the same transaction.

#### `renegotiation_links`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| originalEntryId | UUID | FK to financial_entries |
| newEntryId | UUID | FK to financial_entries |
| originalRemainingPrincipal | decimal(10,2) | Principal owed at renegotiation |
| penaltiesIncluded | decimal(10,2) | Fine + interest rolled into new charge |
| penaltiesWaived | decimal(10,2) | Fine + interest forgiven |
| createdAt | timestamp | |

#### `financial_settings`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| tenantId | UUID | Unique, FK to tenants |
| fineType | varchar(20) | 'percentage' or 'fixed', default 'percentage' |
| fineValue | decimal(5,2) | Default 2.0 — capped at 2% if percentage |
| monthlyInterestPercent | decimal(5,2) | Default 1.0 — capped at 1% |
| gracePeriodDays | integer | Default 0 |
| bankName | varchar(100) | |
| bankAgency | varchar(20) | |
| bankAccount | varchar(30) | |
| pixKeyType | varchar(20) | cpf, cnpj, email, phone, random |
| pixKey | varchar(100) | |
| defaultInstallmentCount | integer | Default 1 |
| defaultPaymentMethod | varchar(20) | |
| updatedBy | UUID | FK to users |
| updatedAt | timestamp | |

### Modifications to Existing Tables

#### `financial_entries` — add columns:
| Column | Type | Notes |
|--------|------|-------|
| renegotiatedAt | timestamp | When this charge was renegotiated |

**New status value:** `'renegotiated'` added to status enum.

#### `installments` — add columns:
| Column | Type | Notes |
|--------|------|-------|
| fineAmount | decimal(10,2) | Default 0 — stored once when first overdue |
| interestAmount | decimal(10,2) | Default 0 — recalculated on read/payment |
| amountPaid | decimal(10,2) | Default 0 — cumulative principal paid |
| lastFineInterestCalcAt | timestamp | Interest accrual start after partial payment |
| appliedFineType | varchar(20) | Snapshotted from settings at first delinquency |
| appliedFineValue | decimal(5,2) | Snapshotted from settings at first delinquency |
| appliedInterestRate | decimal(5,2) | Snapshotted from settings at first delinquency |

---

## 2. Fines, Interest & Art. 354 Compliance

### Fine (Multa Moratoria)
- One-time charge, applied when installment first becomes overdue (past dueDate + gracePeriodDays)
- **Percentage type:** `amount * min(appliedFineValue, 2) / 100`
- **Fixed type:** `min(appliedFineValue, amount * 0.02)` — always capped at 2% of original
- Stored on `installments.fineAmount` — once covered by payment (-> 0), never re-applied
- Guard: only apply if `fineAmount === 0 AND amountPaid === 0`
- At first delinquency, snapshot current settings onto installment: `appliedFineType`, `appliedFineValue`, `appliedInterestRate`

### Interest (Juros Moratorios)
- Simple daily pro-rata: `remainingPrincipal * (appliedInterestRate / 100 / 30) * daysOverdue`
- Max 1% per month (Art. 406 CC / Art. 161 CTN)
- Calculated on remaining principal only (`amount - amountPaid`)
- After partial payment: accrues from `lastFineInterestCalcAt` (payment date), not original due date
- Before any payment: accrues from due date + grace period
- Uses `appliedInterestRate` from installment (snapshotted), not current tenant settings

### Art. 354 Payment Allocation
When payment is received on an overdue installment, allocation order:
1. **Interest** accrued to date
2. **Fine**
3. **Principal**

Example: Installment R$1.000, fine R$20, interest R$10. Patient pays R$25.
- R$10 covers interest (interestAmount -> 0)
- R$15 toward fine (fineAmount -> 5)
- R$0 to principal
- Remaining: R$1.000 principal + R$5 fine

### Backdated Payment Handling
When a payment is recorded with `paidAt` earlier than existing payments on the same installment:
1. Collect all `payment_records` for this installment, ordered by `paidAt` ASC
2. Reset installment to base state: `amountPaid = 0`, `fineAmount` = original fine, `interestAmount = 0`, `lastFineInterestCalcAt = null`
3. Replay each payment in chronological order:
   - Recalculate interest as of that payment's `paidAt`
   - Run `allocatePayment` with recalculated amounts
   - Update installment state and `lastFineInterestCalcAt`
   - Update each `payment_record` with corrected allocation breakdown
4. Update corresponding `cash_movements` if allocation changed

### Concurrency
- Payment recording acquires `SELECT ... FOR UPDATE` on the installment row
- Entire payment + cash_movement creation is wrapped in a single transaction
- Bulk operations lock all affected installment rows before processing

### Implementation

**Pure functions (no side effects):**
```typescript
calculateFine(amount: number, fineType: string, fineValue: number): number
calculateInterest(remainingPrincipal: number, daysOverdue: number, interestRate: number): number
allocatePayment(installment: InstallmentState, paymentAmount: number): { interestCovered, fineCovered, principalCovered }
recalculateAsOfDate(installment: InstallmentState, interestRate: number, asOfDate: Date): { fineAmount, interestAmount }
replayPayments(installment: Installment, payments: PaymentRecord[]): ReplayResult
```

**Key behaviors (proven in Revezza):**
- Fine applied once, stored, decremented by payments, never re-applied after covered
- Interest computed on demand using snapshotted rate from installment
- `lastFineInterestCalcAt` updated on each payment to prevent double-counting interest
- `amountPaid` tracks principal only — total paid comes from summing payment_records
- Legal caps enforced in settings validation: fine max 2%, interest max 1%/month
- Installment is 'paid' when `amountPaid >= amount AND fineAmount <= 0 AND interestAmount <= 0`
- Persisted lifecycle status: pending, paid, cancelled. Computed: isOverdue (dueDate + grace < today AND status = pending), isPartial (amountPaid > 0 AND status != paid)

---

## 3. Expenses Module

### Workflow
1. Create expense: select category, enter description, total amount, installment count
2. Auto-generates installments (divide amount, 30-day intervals) — supports custom due dates per installment
3. Mark installment as paid with payment method -> creates `cash_movements` outflow in same transaction
4. Attach receipts (upload to Supabase Storage)
5. No fines/interest on expenses

### Status Model
- Persisted on `expenses`: pending, paid, cancelled
- Computed: expense is 'paid' when all installments are paid, 'cancelled' explicitly
- Persisted on `expense_installments`: pending, paid
- Computed: isOverdue (dueDate < today AND status = pending)

### Role Access
- Owner + financial: full CRUD
- Other roles: no access to expenses

---

## 4. Renegotiation

### Flow (supports single or multiple charge consolidation)
1. User selects one or more charges (checkboxes) -> clicks "Renegociar"
2. System shows summary table: each selected charge with remaining balance breakdown:
   - Remaining principal (`amount - amountPaid` per unpaid installment)
   - Accrued penalties (fine + interest, recalculated as of today)
   - Total remaining per charge
3. Bottom shows consolidated total + option to waive penalties (partial or full)
4. User defines new terms: installment count, description (pre-filled: "Renegociacao — [patient name]")
5. On confirm (single transaction):
   - Acquire row locks on all affected installments
   - Recalculate penalties as of today on all selected charges
   - Cancel all unpaid installments across selected charges
   - Set all original charges to `status: 'renegotiated'`, `renegotiatedAt: now()`
   - Create one new charge with `totalAmount` = consolidated remaining balance (after waiver)
   - Create `renegotiation_links` rows (one per original charge, preserving `originalRemainingPrincipal`, `penaltiesIncluded`, `penaltiesWaived`)
   - Auto-generate new installments

### UI Display
- New charge shows: "Renegociacao de #12, #15, #18"
- Each original shows: "Renegociado -> #25"
- Renegotiation detail shows breakdown: how much was principal, penalties included, penalties waived

---

## 5. Bulk Operations

### Bulk Mark as Paid
- Select multiple pending installments via checkboxes
- Choose payment method + payment date
- Each installment processed individually through `allocatePayment` (Art. 354 respected)
- Row-level locks acquired on all selected installments before processing
- Single API call, server processes in a transaction
- If any installment fails validation (e.g., already paid), entire batch fails with clear error identifying which installment

### Bulk Cancel
- Select multiple charges via checkboxes
- Confirm with reason (stored in audit log)
- Sets status to cancelled on all selected + their unpaid installments
- Already-paid installments and their payment_records are preserved (historical cash stays in ledger)
- Transaction-wrapped

### UI
- Checkbox column on financial list
- Floating action bar at bottom when any selected: "Marcar como pago (N)" + "Cancelar (N)" + "Renegociar (N)"

---

## 6. Financial Statements & Practitioner P&L

### Ledger (Extrato tab)
Chronological list from `cash_movements` table (single source of truth):
- **Inflows:** patient payments (linked via paymentRecordId)
- **Outflows:** expense payments (linked via expenseInstallmentId)
- **Reversals:** correction entries (linked via reversedByMovementId)

Each row: date, type icon (up arrow inflow / down arrow outflow), description, category or patient name, payment method, amount (green in / red out), running balance.

**Summary cards at top:** Total inflows, Total outflows, Net result, Overdue receivables.

**Export:** CSV download with all visible columns.

### Practitioner P&L (Por Profissional tab)

**Dual attribution model:**

| Column | Attribution | Source |
|--------|-----------|--------|
| Revenue Generated | Procedure date (accrual) | Sum of `financial_entries.totalAmount` linked to practitioner's procedures, grouped by procedure creation date |
| Revenue Collected | Payment date (cash) | Sum of `payment_records.amount` for installments on charges linked to practitioner's procedures |
| Procedures Performed | Procedure date | Count of procedure records |
| Average Ticket | Derived | Revenue Generated / Procedures Performed |
| By Procedure Type | Procedure date | Revenue Generated grouped by procedure type |

**Role-based view:**
- Owner + financial: see all practitioners
- Practitioner: sees only their own P&L (auto-filtered)
- Receptionist: no access to this tab

---

## 7. Filters Per Tab

| Tab | Filters |
|-----|---------|
| A Receber | Status (pending/paid/cancelled/renegotiated), isOverdue toggle, isPartial toggle, patient, date range, payment method |
| Despesas | Status (pending/paid/cancelled), isOverdue toggle, category, date range, payment method |
| Extrato | Movement type (inflow/outflow/all), date range, payment method, category (expenses), patient (charges) |
| Por Profissional | Date range, practitioner (owner sees all, practitioner sees only self) |
| Visao Geral | Date range, practitioner |

**Common UX:**
- Date range picker defaults to current month
- Filters persist in URL search params (shareable/bookmarkable)
- "Limpar filtros" reset button when any filter active
- Filter count badge on mobile (collapsed filter bar)

---

## 8. Financial Settings

### Settings page (`/configuracoes` -> "Financeiro" section)

**Late payment settings:**
- Fine type: percentage or fixed
- Fine value: numeric input (capped at 2% if percentage)
- Monthly interest rate: numeric input (capped at 1%)
- Grace period: days after due date before penalties apply
- Live preview: "Para uma parcela de R$1.000 vencida ha 30 dias: multa R$20 + juros R$10 = R$1.030"

**Bank account / PIX:**
- Bank name, agency, account number
- PIX key type (CPF/CNPJ, email, phone, random) + PIX key value
- Displayed to patients in payment instructions

**Defaults:**
- Default installment count for new charges (1-12)
- Default payment method

**Expense categories:**
- List with drag-to-reorder
- Add custom category (name + lucide icon picker)
- Edit/delete custom (system defaults can be hidden, not deleted)

**Role access:** Owner only. Financial role can view but not modify.

---

## 9. Navigation Structure

### `/financeiro` tabs:
| # | Tab | Content |
|---|-----|---------|
| 1 | A Receber | Charges list — enhanced with bulk ops, renegotiation, penalty display |
| 2 | Despesas | Expenses list with categories, attachments |
| 3 | Extrato | Unified ledger timeline (from cash_movements) |
| 4 | Por Profissional | Practitioner P&L (dual attribution) |
| 5 | Visao Geral | Dashboard — enhanced with expense data + net profit |

### Patient detail financial tab:
- Charges with penalty calculations displayed
- Renegotiation links shown inline
- Partial payment recording with Art. 354 allocation breakdown
- No expenses (clinic-level, not patient-level)

### Charge creation sources:
- Manual from `/financeiro`
- Manual from patient detail tab
- Auto-generated from service wizard step 4 (approval) — respects financial settings defaults
