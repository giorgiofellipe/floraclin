# Financial Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the financial overhaul design (see `docs/plans/2026-03-31-financial-overhaul-design.md`) — Art. 354 penalties, expenses, renegotiation, unified ledger, practitioner P&L, bulk ops, and financial settings.

**Architecture:** Layered approach — schema first, then pure functions (testable without DB), then DB queries, API routes, hooks, and finally components. Each layer is self-contained with tests.

**Tech Stack:** Drizzle ORM + PostgreSQL, Next.js 16 API routes, React Query v5, Vitest + Testing Library, Zod v4, Recharts, Supabase Storage

---

## Parallel Execution Map

```
PHASE 1 — Foundation (must complete before Phase 2)
├── Track A: Schema + Migration
├── Track B: Types + Validations (no DB dependency)
└── Track C: Pure penalty functions + tests (no DB dependency)

PHASE 2 — Data Layer (depends on Phase 1)
├── Track D: Financial settings queries + API
├── Track E: Enhanced charges queries (penalties, partial payments, renegotiation)
├── Track F: Expense queries + API
└── Track G: Cash movements queries + API (ledger)

PHASE 3 — Client Layer (depends on Phase 2)
├── Track H: Financial settings UI
├── Track I: Enhanced A Receber tab (penalties, partial payments, bulk ops, renegotiation)
├── Track J: Despesas tab
├── Track K: Extrato tab (ledger)
└── Track L: Por Profissional tab + enhanced Visao Geral

PHASE 4 — Integration (depends on Phase 3)
└── Track M: Patient detail financial tab enhancement + cross-cutting fixes
```

### Parallel Rules
- Tracks within the same phase can run simultaneously on separate agents
- Each track produces files that don't overlap with other tracks in the same phase
- All tracks in Phase N must complete before Phase N+1 starts
- Each track commits independently

---

## PHASE 1: Foundation

---

### Task 1 (Track A): Schema Migration

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/types/index.ts`

**Context:** Current schema has `financialEntries` (lines 308-326) and `installments` (lines 328-344) in `src/db/schema.ts`. Relations at lines 505-517. Types at `src/types/index.ts`.

**Step 1: Add new columns to existing tables**

In `src/db/schema.ts`, modify `financialEntries` to add `renegotiatedAt`:

```typescript
// Add after line 318 (notes field):
renegotiatedAt: timestamp('renegotiated_at', { withTimezone: true }),
```

Modify `installments` to add penalty + snapshot columns:

```typescript
// Add after line 338 (notes field):
fineAmount: decimal('fine_amount', { precision: 10, scale: 2 }).notNull().default('0'),
interestAmount: decimal('interest_amount', { precision: 10, scale: 2 }).notNull().default('0'),
amountPaid: decimal('amount_paid', { precision: 10, scale: 2 }).notNull().default('0'),
lastFineInterestCalcAt: timestamp('last_fine_interest_calc_at', { withTimezone: true }),
appliedFineType: varchar('applied_fine_type', { length: 20 }),
appliedFineValue: decimal('applied_fine_value', { precision: 5, scale: 2 }),
appliedInterestRate: decimal('applied_interest_rate', { precision: 5, scale: 2 }),
```

**Step 2: Add new tables**

After the installments table definition (after line 344), add all new tables:

```typescript
// ─── CASH MOVEMENTS (append-only ledger) ─────────────────────────────

export const cashMovements = floraclinSchema.table('cash_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  type: varchar('type', { length: 20 }).notNull(), // 'inflow' | 'outflow'
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  paymentMethod: varchar('payment_method', { length: 20 }),
  movementDate: timestamp('movement_date', { withTimezone: true }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  paymentRecordId: uuid('payment_record_id'),
  expenseInstallmentId: uuid('expense_installment_id'),
  patientId: uuid('patient_id').references(() => patients.id),
  expenseCategoryId: uuid('expense_category_id'),
  recordedBy: uuid('recorded_by').notNull().references(() => users.id),
  reversedByMovementId: uuid('reversed_by_movement_id'),
}, (table) => [
  index('idx_cash_movements_tenant_date').on(table.tenantId, table.movementDate),
  index('idx_cash_movements_type').on(table.tenantId, table.type),
])

// ─── PAYMENT RECORDS ─────────────────────────────────────────────────

export const paymentRecords = floraclinSchema.table('payment_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  installmentId: uuid('installment_id').notNull().references(() => installments.id),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  paymentMethod: varchar('payment_method', { length: 20 }).notNull(),
  interestCovered: decimal('interest_covered', { precision: 10, scale: 2 }).notNull().default('0'),
  fineCovered: decimal('fine_covered', { precision: 10, scale: 2 }).notNull().default('0'),
  principalCovered: decimal('principal_covered', { precision: 10, scale: 2 }).notNull().default('0'),
  paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  recordedBy: uuid('recorded_by').notNull().references(() => users.id),
  notes: text('notes'),
}, (table) => [
  index('idx_payment_records_installment').on(table.installmentId),
])

// ─── RENEGOTIATION LINKS ─────────────────────────────────────────────

export const renegotiationLinks = floraclinSchema.table('renegotiation_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  originalEntryId: uuid('original_entry_id').notNull().references(() => financialEntries.id),
  newEntryId: uuid('new_entry_id').notNull().references(() => financialEntries.id),
  originalRemainingPrincipal: decimal('original_remaining_principal', { precision: 10, scale: 2 }).notNull(),
  penaltiesIncluded: decimal('penalties_included', { precision: 10, scale: 2 }).notNull().default('0'),
  penaltiesWaived: decimal('penalties_waived', { precision: 10, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_renegotiation_links_original').on(table.originalEntryId),
  index('idx_renegotiation_links_new').on(table.newEntryId),
])

// ─── EXPENSES ────────────────────────────────────────────────────────

export const expenses = floraclinSchema.table('expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  categoryId: uuid('category_id').notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),
  installmentCount: integer('installment_count').notNull().default(1),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  notes: text('notes'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('idx_expenses_tenant').on(table.tenantId),
  index('idx_expenses_category').on(table.tenantId, table.categoryId),
])

export const expenseInstallments = floraclinSchema.table('expense_installments', {
  id: uuid('id').primaryKey().defaultRandom(),
  expenseId: uuid('expense_id').notNull().references(() => expenses.id),
  installmentNumber: integer('installment_number').notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  dueDate: date('due_date').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  paymentMethod: varchar('payment_method', { length: 20 }),
  notes: text('notes'),
}, (table) => [
  index('idx_expense_installments_expense').on(table.expenseId),
])

export const expenseCategories = floraclinSchema.table('expense_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id'), // null = system default
  name: varchar('name', { length: 100 }).notNull(),
  icon: varchar('icon', { length: 50 }).notNull().default('circle'),
  isSystem: boolean('is_system').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('idx_expense_categories_tenant').on(table.tenantId),
])

export const expenseAttachments = floraclinSchema.table('expense_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  expenseId: uuid('expense_id').notNull().references(() => expenses.id),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileUrl: text('file_url').notNull(),
  fileSize: integer('file_size').notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_expense_attachments_expense').on(table.expenseId),
])

// ─── FINANCIAL SETTINGS ──────────────────────────────────────────────

export const financialSettings = floraclinSchema.table('financial_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id).unique(),
  fineType: varchar('fine_type', { length: 20 }).notNull().default('percentage'),
  fineValue: decimal('fine_value', { precision: 5, scale: 2 }).notNull().default('2.00'),
  monthlyInterestPercent: decimal('monthly_interest_percent', { precision: 5, scale: 2 }).notNull().default('1.00'),
  gracePeriodDays: integer('grace_period_days').notNull().default(0),
  bankName: varchar('bank_name', { length: 100 }),
  bankAgency: varchar('bank_agency', { length: 20 }),
  bankAccount: varchar('bank_account', { length: 30 }),
  pixKeyType: varchar('pix_key_type', { length: 20 }),
  pixKey: varchar('pix_key', { length: 100 }),
  defaultInstallmentCount: integer('default_installment_count').notNull().default(1),
  defaultPaymentMethod: varchar('default_payment_method', { length: 20 }),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

**Step 3: Add relations for new tables**

After the existing `installmentsRelations` (line 517), add:

```typescript
export const paymentRecordsRelations = relations(paymentRecords, ({ one }) => ({
  installment: one(installments, { fields: [paymentRecords.installmentId], references: [installments.id] }),
  recordedByUser: one(users, { fields: [paymentRecords.recordedBy], references: [users.id] }),
}))

export const renegotiationLinksRelations = relations(renegotiationLinks, ({ one }) => ({
  originalEntry: one(financialEntries, { fields: [renegotiationLinks.originalEntryId], references: [financialEntries.id], relationName: 'renegotiatedFrom' }),
  newEntry: one(financialEntries, { fields: [renegotiationLinks.newEntryId], references: [financialEntries.id], relationName: 'renegotiatedTo' }),
}))

export const cashMovementsRelations = relations(cashMovements, ({ one }) => ({
  tenant: one(tenants, { fields: [cashMovements.tenantId], references: [tenants.id] }),
  recordedByUser: one(users, { fields: [cashMovements.recordedBy], references: [users.id] }),
  patient: one(patients, { fields: [cashMovements.patientId], references: [patients.id] }),
}))

export const expensesRelations = relations(expenses, ({ one, many }) => ({
  tenant: one(tenants, { fields: [expenses.tenantId], references: [tenants.id] }),
  category: one(expenseCategories, { fields: [expenses.categoryId], references: [expenseCategories.id] }),
  createdByUser: one(users, { fields: [expenses.createdBy], references: [users.id] }),
  installments: many(expenseInstallments),
  attachments: many(expenseAttachments),
}))

export const expenseInstallmentsRelations = relations(expenseInstallments, ({ one }) => ({
  expense: one(expenses, { fields: [expenseInstallments.expenseId], references: [expenses.id] }),
}))

export const expenseCategoriesRelations = relations(expenseCategories, ({ one }) => ({
  tenant: one(tenants, { fields: [expenseCategories.tenantId], references: [tenants.id] }),
}))

export const expenseAttachmentsRelations = relations(expenseAttachments, ({ one }) => ({
  expense: one(expenseAttachments, { fields: [expenseAttachments.expenseId], references: [expenses.id] }),
  uploadedByUser: one(users, { fields: [expenseAttachments.uploadedBy], references: [users.id] }),
}))

export const financialSettingsRelations = relations(financialSettings, ({ one }) => ({
  tenant: one(tenants, { fields: [financialSettings.tenantId], references: [tenants.id] }),
}))
```

Also update `installmentsRelations` to include paymentRecords:
```typescript
export const installmentsRelations = relations(installments, ({ one, many }) => ({
  tenant: one(tenants, { fields: [installments.tenantId], references: [tenants.id] }),
  financialEntry: one(financialEntries, { fields: [installments.financialEntryId], references: [financialEntries.id] }),
  paymentRecords: many(paymentRecords),
}))
```

**Step 4: Update types**

In `src/types/index.ts`, add:

```typescript
export type FinancialStatus = 'pending' | 'partial' | 'paid' | 'overdue' | 'cancelled' | 'renegotiated'

export type ExpenseStatus = 'pending' | 'paid' | 'cancelled'

export type CashMovementType = 'inflow' | 'outflow'

export type FineType = 'percentage' | 'fixed'

export type PixKeyType = 'cpf' | 'cnpj' | 'email' | 'phone' | 'random'
```

Update the existing `FinancialStatus` to include `'renegotiated'`. Remove `InstallmentStatus` (lifecycle is now just pending/paid/cancelled, overdue is computed).

**Step 5: Generate and run migration**

Run: `pnpm drizzle-kit generate`
Run: `pnpm drizzle-kit migrate`

**Step 6: Seed default expense categories**

Create `src/db/seeds/expense-categories.ts`:

```typescript
import { db } from '@/db/client'
import { expenseCategories } from '@/db/schema'

const defaults = [
  { name: 'Aluguel', icon: 'home', sortOrder: 0 },
  { name: 'Materiais/Insumos', icon: 'package', sortOrder: 1 },
  { name: 'Folha de Pagamento', icon: 'users', sortOrder: 2 },
  { name: 'Marketing', icon: 'megaphone', sortOrder: 3 },
  { name: 'Equipamentos', icon: 'monitor', sortOrder: 4 },
  { name: 'Impostos/Taxas', icon: 'receipt', sortOrder: 5 },
  { name: 'Servicos Terceirizados', icon: 'briefcase', sortOrder: 6 },
  { name: 'Manutencao', icon: 'wrench', sortOrder: 7 },
  { name: 'Outros', icon: 'circle', sortOrder: 8 },
]

export async function seedExpenseCategories() {
  for (const cat of defaults) {
    await db.insert(expenseCategories).values({
      ...cat,
      tenantId: null,
      isSystem: true,
    }).onConflictDoNothing()
  }
}
```

**Step 7: Commit**

```bash
git add src/db/schema.ts src/types/index.ts src/db/seeds/expense-categories.ts
git commit -m "feat(financial): add schema for penalties, expenses, cash movements, settings"
```

---

### Task 2 (Track B): Validation Schemas

**Files:**
- Modify: `src/validations/financial.ts`
- Create: `src/validations/expenses.ts`
- Create: `src/validations/financial-settings.ts`
- Test: `src/validations/__tests__/financial.test.ts` (update)
- Test: `src/validations/__tests__/expenses.test.ts`
- Test: `src/validations/__tests__/financial-settings.test.ts`

**No DB dependency — can run in parallel with Track A.**

**Step 1: Update financial validations**

Modify `src/validations/financial.ts`:

```typescript
import { z } from 'zod'
import type { PaymentMethod, FinancialStatus } from '@/types'

const paymentMethods: PaymentMethod[] = ['pix', 'credit_card', 'debit_card', 'cash', 'transfer']
const financialStatuses: FinancialStatus[] = ['pending', 'partial', 'paid', 'overdue', 'cancelled', 'renegotiated']

export const createFinancialEntrySchema = z.object({
  patientId: z.string().uuid('Paciente invalido'),
  procedureRecordId: z.string().uuid('Procedimento invalido').optional(),
  appointmentId: z.string().uuid('Agendamento invalido').optional(),
  description: z.string().min(1, 'Descricao e obrigatoria'),
  totalAmount: z.number().positive('Valor deve ser positivo'),
  installmentCount: z.number().int().min(1, 'Minimo 1 parcela').max(12, 'Maximo 12 parcelas'),
  notes: z.string().optional(),
})

export const recordPaymentSchema = z.object({
  installmentId: z.string().uuid('Parcela invalida'),
  amount: z.number().positive('Valor deve ser positivo'),
  paymentMethod: z.enum(paymentMethods as [string, ...string[]], {
    message: 'Metodo de pagamento invalido',
  }),
  paidAt: z.string().datetime({ offset: true }).optional(), // ISO string, defaults to now
  notes: z.string().optional(),
})

export const renegotiateSchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos uma cobranca'),
  newInstallmentCount: z.number().int().min(1).max(24),
  description: z.string().min(1, 'Descricao e obrigatoria'),
  waivePenalties: z.boolean().optional().default(false),
  waiveAmount: z.number().min(0).optional().default(0),
})

export const bulkPaySchema = z.object({
  installmentIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos uma parcela'),
  paymentMethod: z.enum(paymentMethods as [string, ...string[]], {
    message: 'Metodo de pagamento invalido',
  }),
  paidAt: z.string().datetime({ offset: true }).optional(),
})

export const bulkCancelSchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos uma cobranca'),
  reason: z.string().min(1, 'Motivo e obrigatorio'),
})

// Keep existing for backwards compat
export const payInstallmentSchema = z.object({
  installmentId: z.string().uuid('Parcela invalida'),
  paymentMethod: z.enum(paymentMethods as [string, ...string[]], {
    message: 'Metodo de pagamento invalido',
  }),
})

export const financialFilterSchema = z.object({
  patientId: z.string().uuid().optional(),
  status: z.enum(financialStatuses as [string, ...string[]]).optional(),
  isOverdue: z.boolean().optional(),
  isPartial: z.boolean().optional(),
  paymentMethod: z.enum(paymentMethods as [string, ...string[]]).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.number().int().positive().optional().default(1),
  limit: z.number().int().positive().max(100).optional().default(20),
})

export const revenueFilterSchema = z.object({
  dateFrom: z.string().min(1, 'Data inicial e obrigatoria'),
  dateTo: z.string().min(1, 'Data final e obrigatoria'),
  practitionerId: z.string().uuid().optional(),
})

export const ledgerFilterSchema = z.object({
  type: z.enum(['inflow', 'outflow', 'all'] as [string, ...string[]]).optional().default('all'),
  paymentMethod: z.enum(paymentMethods as [string, ...string[]]).optional(),
  patientId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  dateFrom: z.string().min(1),
  dateTo: z.string().min(1),
  page: z.number().int().positive().optional().default(1),
  limit: z.number().int().positive().max(100).optional().default(50),
})

export type CreateFinancialEntryInput = z.infer<typeof createFinancialEntrySchema>
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>
export type RenegotiateInput = z.infer<typeof renegotiateSchema>
export type BulkPayInput = z.infer<typeof bulkPaySchema>
export type BulkCancelInput = z.infer<typeof bulkCancelSchema>
export type PayInstallmentInput = z.infer<typeof payInstallmentSchema>
export type FinancialFilterInput = z.infer<typeof financialFilterSchema>
export type RevenueFilterInput = z.infer<typeof revenueFilterSchema>
export type LedgerFilterInput = z.infer<typeof ledgerFilterSchema>
```

**Step 2: Create expense validations** (`src/validations/expenses.ts`):

```typescript
import { z } from 'zod'
import type { PaymentMethod } from '@/types'

const paymentMethods: PaymentMethod[] = ['pix', 'credit_card', 'debit_card', 'cash', 'transfer']

export const createExpenseSchema = z.object({
  categoryId: z.string().uuid('Categoria invalida'),
  description: z.string().min(1, 'Descricao e obrigatoria'),
  totalAmount: z.number().positive('Valor deve ser positivo'),
  installmentCount: z.number().int().min(1, 'Minimo 1 parcela').max(24, 'Maximo 24 parcelas'),
  notes: z.string().optional(),
  customDueDates: z.array(z.string()).optional(), // ISO date strings, one per installment
})

export const payExpenseInstallmentSchema = z.object({
  installmentId: z.string().uuid('Parcela invalida'),
  paymentMethod: z.enum(paymentMethods as [string, ...string[]], {
    message: 'Metodo de pagamento invalido',
  }),
  paidAt: z.string().datetime({ offset: true }).optional(),
})

export const expenseFilterSchema = z.object({
  status: z.enum(['pending', 'paid', 'cancelled'] as [string, ...string[]]).optional(),
  categoryId: z.string().uuid().optional(),
  isOverdue: z.boolean().optional(),
  paymentMethod: z.enum(paymentMethods as [string, ...string[]]).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.number().int().positive().optional().default(1),
  limit: z.number().int().positive().max(100).optional().default(20),
})

export const expenseCategorySchema = z.object({
  name: z.string().min(1, 'Nome e obrigatorio').max(100),
  icon: z.string().min(1).max(50).default('circle'),
})

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>
export type PayExpenseInstallmentInput = z.infer<typeof payExpenseInstallmentSchema>
export type ExpenseFilterInput = z.infer<typeof expenseFilterSchema>
export type ExpenseCategoryInput = z.infer<typeof expenseCategorySchema>
```

**Step 3: Create financial settings validations** (`src/validations/financial-settings.ts`):

```typescript
import { z } from 'zod'
import type { FineType, PixKeyType, PaymentMethod } from '@/types'

const fineTypes: FineType[] = ['percentage', 'fixed']
const pixKeyTypes: PixKeyType[] = ['cpf', 'cnpj', 'email', 'phone', 'random']
const paymentMethods: PaymentMethod[] = ['pix', 'credit_card', 'debit_card', 'cash', 'transfer']

export const updateFinancialSettingsSchema = z.object({
  fineType: z.enum(fineTypes as [string, ...string[]]).optional(),
  fineValue: z.number().min(0).max(2, 'Multa nao pode exceder 2%').optional(),
  monthlyInterestPercent: z.number().min(0).max(1, 'Juros nao pode exceder 1% ao mes').optional(),
  gracePeriodDays: z.number().int().min(0).max(30).optional(),
  bankName: z.string().max(100).optional().nullable(),
  bankAgency: z.string().max(20).optional().nullable(),
  bankAccount: z.string().max(30).optional().nullable(),
  pixKeyType: z.enum(pixKeyTypes as [string, ...string[]]).optional().nullable(),
  pixKey: z.string().max(100).optional().nullable(),
  defaultInstallmentCount: z.number().int().min(1).max(12).optional(),
  defaultPaymentMethod: z.enum(paymentMethods as [string, ...string[]]).optional().nullable(),
})

export type UpdateFinancialSettingsInput = z.infer<typeof updateFinancialSettingsSchema>
```

**Step 4: Write tests for ALL validation schemas**

Update `src/validations/__tests__/financial.test.ts` — add tests for `recordPaymentSchema`, `renegotiateSchema`, `bulkPaySchema`, `bulkCancelSchema`, `ledgerFilterSchema`.

Create `src/validations/__tests__/expenses.test.ts` — test `createExpenseSchema`, `payExpenseInstallmentSchema`, `expenseFilterSchema`, `expenseCategorySchema`.

Create `src/validations/__tests__/financial-settings.test.ts` — test `updateFinancialSettingsSchema` including legal cap enforcement (fine max 2%, interest max 1%).

**Test patterns to cover per schema:**
- Valid data passes
- Each required field missing fails
- Edge cases (min/max values)
- Invalid enum values fail
- Optional fields work when omitted
- For financial-settings: `fineValue: 2.01` must fail, `monthlyInterestPercent: 1.01` must fail

**Step 5: Run tests**

Run: `pnpm vitest run src/validations/__tests__/`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/validations/ src/validations/__tests__/
git commit -m "feat(financial): add validation schemas for payments, expenses, settings, renegotiation"
```

---

### Task 3 (Track C): Pure Penalty Calculation Functions

**Files:**
- Create: `src/lib/financial/penalties.ts`
- Test: `src/lib/financial/__tests__/penalties.test.ts`

**No DB dependency — pure functions only. Can run in parallel with Tracks A and B.**

**Step 1: Write comprehensive tests first**

Create `src/lib/financial/__tests__/penalties.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  calculateFine,
  calculateInterest,
  allocatePayment,
  replayPayments,
  getDaysOverdue,
} from '../penalties'

describe('calculateFine', () => {
  it('calculates percentage fine correctly', () => {
    expect(calculateFine(1000, 'percentage', 2)).toBe(20)
  })

  it('caps percentage fine at 2%', () => {
    expect(calculateFine(1000, 'percentage', 5)).toBe(20) // 2% cap
  })

  it('calculates fixed fine correctly', () => {
    expect(calculateFine(1000, 'fixed', 15)).toBe(15)
  })

  it('caps fixed fine at 2% of amount', () => {
    expect(calculateFine(1000, 'fixed', 50)).toBe(20) // 2% = 20
  })

  it('returns 0 when fine value is 0', () => {
    expect(calculateFine(1000, 'percentage', 0)).toBe(0)
  })

  it('rounds to 2 decimal places', () => {
    expect(calculateFine(333.33, 'percentage', 2)).toBe(6.67)
  })
})

describe('calculateInterest', () => {
  it('calculates 1% monthly interest for 30 days', () => {
    expect(calculateInterest(1000, 30, 1)).toBe(10)
  })

  it('calculates pro-rata daily interest', () => {
    expect(calculateInterest(1000, 15, 1)).toBe(5) // half month
  })

  it('caps interest at 1% per month', () => {
    expect(calculateInterest(1000, 30, 2)).toBe(10) // capped at 1%
  })

  it('returns 0 for 0 days overdue', () => {
    expect(calculateInterest(1000, 0, 1)).toBe(0)
  })

  it('returns 0 for 0 remaining principal', () => {
    expect(calculateInterest(0, 30, 1)).toBe(0)
  })

  it('returns 0 for negative days', () => {
    expect(calculateInterest(1000, -5, 1)).toBe(0)
  })

  it('handles 90 days overdue correctly', () => {
    expect(calculateInterest(1000, 90, 1)).toBe(30) // 3 months
  })

  it('rounds to 2 decimal places', () => {
    expect(calculateInterest(333.33, 7, 1)).toBe(0.78)
  })
})

describe('getDaysOverdue', () => {
  it('returns 0 when not yet due', () => {
    const future = new Date()
    future.setDate(future.getDate() + 10)
    expect(getDaysOverdue(future.toISOString(), 0)).toBe(0)
  })

  it('respects grace period', () => {
    const past = new Date()
    past.setDate(past.getDate() - 2)
    expect(getDaysOverdue(past.toISOString(), 3)).toBe(0) // within grace
    expect(getDaysOverdue(past.toISOString(), 1)).toBe(1) // 2 days - 1 grace = 1
  })

  it('counts days after grace period', () => {
    const past = new Date()
    past.setDate(past.getDate() - 35)
    expect(getDaysOverdue(past.toISOString(), 5)).toBe(30)
  })
})

describe('allocatePayment (Art. 354)', () => {
  it('allocates to interest first', () => {
    const result = allocatePayment({
      amount: 1000, amountPaid: 0, fineAmount: 20, interestAmount: 10,
    }, 10)
    expect(result.interestCovered).toBe(10)
    expect(result.fineCovered).toBe(0)
    expect(result.principalCovered).toBe(0)
  })

  it('allocates to fine after interest', () => {
    const result = allocatePayment({
      amount: 1000, amountPaid: 0, fineAmount: 20, interestAmount: 10,
    }, 25)
    expect(result.interestCovered).toBe(10)
    expect(result.fineCovered).toBe(15)
    expect(result.principalCovered).toBe(0)
  })

  it('allocates to principal after interest and fine', () => {
    const result = allocatePayment({
      amount: 1000, amountPaid: 0, fineAmount: 20, interestAmount: 10,
    }, 530)
    expect(result.interestCovered).toBe(10)
    expect(result.fineCovered).toBe(20)
    expect(result.principalCovered).toBe(500)
  })

  it('handles full payoff', () => {
    const result = allocatePayment({
      amount: 1000, amountPaid: 0, fineAmount: 20, interestAmount: 10,
    }, 1030)
    expect(result.interestCovered).toBe(10)
    expect(result.fineCovered).toBe(20)
    expect(result.principalCovered).toBe(1000)
  })

  it('handles overpayment - caps at total due', () => {
    const result = allocatePayment({
      amount: 1000, amountPaid: 0, fineAmount: 20, interestAmount: 10,
    }, 2000)
    expect(result.principalCovered).toBe(1000)
    expect(result.interestCovered + result.fineCovered + result.principalCovered).toBe(1030)
  })

  it('handles partially paid principal', () => {
    const result = allocatePayment({
      amount: 1000, amountPaid: 500, fineAmount: 5, interestAmount: 3,
    }, 508)
    expect(result.interestCovered).toBe(3)
    expect(result.fineCovered).toBe(5)
    expect(result.principalCovered).toBe(500)
  })

  it('handles payment less than interest', () => {
    const result = allocatePayment({
      amount: 1000, amountPaid: 0, fineAmount: 20, interestAmount: 50,
    }, 30)
    expect(result.interestCovered).toBe(30)
    expect(result.fineCovered).toBe(0)
    expect(result.principalCovered).toBe(0)
  })

  it('handles no penalties (non-overdue installment)', () => {
    const result = allocatePayment({
      amount: 1000, amountPaid: 0, fineAmount: 0, interestAmount: 0,
    }, 1000)
    expect(result.interestCovered).toBe(0)
    expect(result.fineCovered).toBe(0)
    expect(result.principalCovered).toBe(1000)
  })
})

describe('replayPayments', () => {
  it('replays single payment correctly', () => {
    const result = replayPayments(
      { amount: 1000, dueDate: '2026-01-01', appliedFineValue: 2, appliedFineType: 'percentage', appliedInterestRate: 1, gracePeriodDays: 0 },
      [{ amount: 500, paidAt: '2026-02-01T00:00:00Z' }], // 31 days overdue
    )
    expect(result.payments.length).toBe(1)
    expect(result.payments[0].interestCovered).toBeGreaterThan(0)
    expect(result.installmentState.amountPaid).toBeGreaterThan(0)
  })

  it('replays two payments in chronological order', () => {
    const result = replayPayments(
      { amount: 1000, dueDate: '2026-01-01', appliedFineValue: 2, appliedFineType: 'percentage', appliedInterestRate: 1, gracePeriodDays: 0 },
      [
        { amount: 200, paidAt: '2026-02-01T00:00:00Z' },
        { amount: 300, paidAt: '2026-03-01T00:00:00Z' },
      ],
    )
    expect(result.payments.length).toBe(2)
    // Second payment should have less interest (lower remaining principal)
    expect(result.installmentState.amountPaid).toBeGreaterThan(0)
  })

  it('handles backdated payment insertion correctly', () => {
    // Payment 1 recorded March 1, payment 2 backdated to Feb 1
    const result = replayPayments(
      { amount: 1000, dueDate: '2026-01-01', appliedFineValue: 2, appliedFineType: 'percentage', appliedInterestRate: 1, gracePeriodDays: 0 },
      [
        { amount: 200, paidAt: '2026-02-01T00:00:00Z' }, // backdated
        { amount: 300, paidAt: '2026-03-01T00:00:00Z' }, // original
      ],
    )
    // After replay, both allocations should be correct for their respective dates
    expect(result.payments[0].paidAt).toBe('2026-02-01T00:00:00Z')
    expect(result.payments[1].paidAt).toBe('2026-03-01T00:00:00Z')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/financial/__tests__/penalties.test.ts`
Expected: FAIL (module not found)

**Step 3: Implement pure functions**

Create `src/lib/financial/penalties.ts`:

```typescript
const MAX_FINE_PERCENTAGE = 2
const MAX_INTEREST_MONTHLY = 1
const DAYS_IN_MONTH = 30

export interface InstallmentState {
  amount: number
  amountPaid: number
  fineAmount: number
  interestAmount: number
}

export interface InstallmentBase {
  amount: number
  dueDate: string
  appliedFineValue: number
  appliedFineType: string
  appliedInterestRate: number
  gracePeriodDays: number
}

export interface PaymentInput {
  amount: number
  paidAt: string
}

export interface PaymentAllocation {
  interestCovered: number
  fineCovered: number
  principalCovered: number
}

export interface ReplayedPayment extends PaymentAllocation {
  amount: number
  paidAt: string
}

export interface ReplayResult {
  payments: ReplayedPayment[]
  installmentState: {
    amountPaid: number
    fineAmount: number
    interestAmount: number
    lastFineInterestCalcAt: string | null
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function calculateFine(amount: number, fineType: string, fineValue: number): number {
  if (!fineValue || fineValue <= 0) return 0
  let fine: number
  if (fineType === 'percentage') {
    const rate = Math.min(fineValue, MAX_FINE_PERCENTAGE)
    fine = (amount * rate) / 100
  } else {
    const maxFine = (amount * MAX_FINE_PERCENTAGE) / 100
    fine = Math.min(fineValue, maxFine)
  }
  return round2(fine)
}

export function calculateInterest(
  remainingPrincipal: number,
  daysOverdue: number,
  monthlyRate: number,
): number {
  if (remainingPrincipal <= 0 || daysOverdue <= 0) return 0
  const cappedRate = Math.min(monthlyRate, MAX_INTEREST_MONTHLY)
  const dailyRate = cappedRate / 100 / DAYS_IN_MONTH
  return round2(remainingPrincipal * dailyRate * daysOverdue)
}

export function getDaysOverdue(
  dueDate: string,
  gracePeriodDays: number,
  asOf?: Date,
): number {
  const due = new Date(dueDate)
  const ref = asOf ?? new Date()
  const diffMs = ref.getTime() - due.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  return Math.max(0, diffDays - gracePeriodDays)
}

export function allocatePayment(
  state: InstallmentState,
  paymentAmount: number,
): PaymentAllocation {
  let remaining = paymentAmount

  const interestCovered = round2(Math.min(remaining, state.interestAmount))
  remaining = round2(remaining - interestCovered)

  const fineCovered = round2(Math.min(remaining, state.fineAmount))
  remaining = round2(remaining - fineCovered)

  const maxPrincipal = round2(Math.max(state.amount - state.amountPaid, 0))
  const principalCovered = round2(Math.min(remaining, maxPrincipal))

  return { interestCovered, fineCovered, principalCovered }
}

export function replayPayments(
  base: InstallmentBase,
  payments: PaymentInput[],
): ReplayResult {
  // Sort by paidAt ascending
  const sorted = [...payments].sort(
    (a, b) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime(),
  )

  let amountPaid = 0
  let fineAmount = 0
  let fineApplied = false
  let lastCalcAt: string | null = null
  const replayedPayments: ReplayedPayment[] = []

  for (const payment of sorted) {
    const paymentDate = new Date(payment.paidAt)
    const interestStartDate = lastCalcAt ? lastCalcAt : base.dueDate
    const daysOverdue = getDaysOverdue(interestStartDate, lastCalcAt ? 0 : base.gracePeriodDays, paymentDate)

    // Apply fine once on first overdue payment
    if (!fineApplied && daysOverdue > 0 && amountPaid === 0) {
      fineAmount = calculateFine(base.amount, base.appliedFineType, base.appliedFineValue)
      fineApplied = true
    }

    const remainingPrincipal = base.amount - amountPaid
    const interestAmount = calculateInterest(remainingPrincipal, daysOverdue, base.appliedInterestRate)

    const allocation = allocatePayment(
      { amount: base.amount, amountPaid, fineAmount, interestAmount },
      payment.amount,
    )

    fineAmount = round2(fineAmount - allocation.fineCovered)
    amountPaid = round2(amountPaid + allocation.principalCovered)
    lastCalcAt = payment.paidAt

    replayedPayments.push({
      ...allocation,
      amount: payment.amount,
      paidAt: payment.paidAt,
    })
  }

  // Recalculate current interest for display
  const currentDaysOverdue = getDaysOverdue(
    lastCalcAt ?? base.dueDate,
    lastCalcAt ? 0 : base.gracePeriodDays,
  )
  const currentInterest = calculateInterest(base.amount - amountPaid, currentDaysOverdue, base.appliedInterestRate)

  return {
    payments: replayedPayments,
    installmentState: {
      amountPaid,
      fineAmount,
      interestAmount: currentInterest,
      lastFineInterestCalcAt: lastCalcAt,
    },
  }
}
```

**Step 4: Run tests**

Run: `pnpm vitest run src/lib/financial/__tests__/penalties.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/lib/financial/
git commit -m "feat(financial): implement Art. 354 penalty calculations with full test coverage"
```

---

## PHASE 2: Data Layer

**Depends on Phase 1 completion (schema exists, types exist, pure functions exist).**

---

### Task 4 (Track D): Financial Settings Queries + API

**Files:**
- Create: `src/db/queries/financial-settings.ts`
- Create: `src/app/api/financial/settings/route.ts`
- Modify: `src/hooks/queries/query-keys.ts`
- Create: `src/hooks/queries/use-financial-settings.ts`
- Create: `src/hooks/mutations/use-financial-settings-mutations.ts`
- Test: `src/db/queries/__tests__/financial-settings.test.ts`
- Test: `src/app/api/financial/settings/__tests__/route.test.ts`

**Step 1: Implement DB queries** (`src/db/queries/financial-settings.ts`):

Functions needed:
- `getFinancialSettings(tenantId)` — returns settings or creates with defaults if none exists
- `updateFinancialSettings(tenantId, userId, data)` — upserts settings
- `getExpenseCategories(tenantId)` — returns system defaults + tenant custom categories
- `createExpenseCategory(tenantId, data)` — creates custom category
- `updateExpenseCategory(tenantId, categoryId, data)` — updates name/icon
- `deleteExpenseCategory(tenantId, categoryId)` — soft deletes (only non-system)
- `reorderExpenseCategories(tenantId, orderedIds)` — updates sortOrder

**Step 2: Implement API routes** (`src/app/api/financial/settings/route.ts`):

- `GET` — returns settings + categories. Roles: owner, financial (read)
- `PUT` — updates settings. Roles: owner only

Create `src/app/api/financial/settings/categories/route.ts`:
- `GET` — list categories. Roles: owner, financial
- `POST` — create category. Roles: owner only

Create `src/app/api/financial/settings/categories/[id]/route.ts`:
- `PUT` — update category. Roles: owner only
- `DELETE` — soft delete category. Roles: owner only

**Step 3: Add query keys, hooks**

Add to `query-keys.ts`:
```typescript
financial: {
  // ... existing
  settings: ['financial', 'settings'] as const,
  categories: ['financial', 'categories'] as const,
}
```

Create query hook `use-financial-settings.ts` and mutation hook `use-financial-settings-mutations.ts`.

**Step 4: Write tests, run, commit**

---

### Task 5 (Track E): Enhanced Charge Queries (Penalties, Partial Payments, Renegotiation)

**Files:**
- Modify: `src/db/queries/financial.ts` (heavy rewrite)
- Create: `src/db/queries/renegotiation.ts`
- Test: `src/db/queries/__tests__/financial-enhanced.test.ts`

**Step 1: Rewrite `payInstallment` to use `payment_records` + Art. 354**

Replace the existing `payInstallment` function with `recordPayment`:
- Acquires `SELECT ... FOR UPDATE` on installment row
- Loads financial settings (snapshotted rates from installment)
- If first delinquency (no snapshot yet), snapshots current settings
- Calculates current penalties using pure functions
- Runs `allocatePayment`
- Creates `payment_records` row
- Creates `cash_movements` inflow row
- Updates installment state (`amountPaid`, `fineAmount`, `interestAmount`, `lastFineInterestCalcAt`)
- Updates parent `financial_entries` status
- If backdated: calls `replayPayments` and updates all payment records

**Step 2: Add `renegotiateCharges` function** (`src/db/queries/renegotiation.ts`):
- Accepts array of entry IDs
- Locks all related installments
- Calculates remaining per entry (principal + penalties)
- Optionally waives penalties
- Cancels unpaid installments
- Marks entries as renegotiated
- Creates new entry + installments
- Creates `renegotiation_links`
- Returns new entry

**Step 3: Add `bulkPayInstallments` and `bulkCancelEntries`**

**Step 4: Update `listFinancialEntries` to include computed overdue/partial flags and renegotiation links**

**Step 5: Update `getFinancialEntry` to include payment records, penalty calculations, renegotiation info**

**Step 6: Update `getRevenueOverview` to include expense data and net profit**

**Step 7: Write tests and commit**

---

### Task 6 (Track F): Expense Queries + API

**Files:**
- Create: `src/db/queries/expenses.ts`
- Create: `src/app/api/expenses/route.ts`
- Create: `src/app/api/expenses/[id]/route.ts`
- Create: `src/app/api/expenses/installments/[id]/pay/route.ts`
- Create: `src/app/api/expenses/attachments/route.ts`
- Modify: `src/hooks/queries/query-keys.ts`
- Create: `src/hooks/queries/use-expenses.ts`
- Create: `src/hooks/mutations/use-expense-mutations.ts`
- Test: `src/db/queries/__tests__/expenses.test.ts`

**Step 1: Implement DB queries** (`src/db/queries/expenses.ts`):

Functions:
- `createExpense(tenantId, userId, data)` — creates expense + auto-generates installments (custom due dates supported)
- `listExpenses(tenantId, filters)` — paginated list with category info, paid count
- `getExpense(tenantId, expenseId)` — full detail with installments + attachments
- `payExpenseInstallment(tenantId, installmentId, paymentMethod, userId, paidAt?)` — marks paid + creates cash_movements outflow
- `cancelExpense(tenantId, expenseId)` — cancels expense + unpaid installments
- `addExpenseAttachment(tenantId, expenseId, data, userId)` — records attachment
- `deleteExpenseAttachment(tenantId, attachmentId)` — removes attachment

**Step 2: Implement API routes with role checks** (owner + financial only)

**Step 3: Add query keys, hooks, mutations**

Add to `query-keys.ts`:
```typescript
expenses: {
  all: ['expenses'] as const,
  list: (filters?: Record<string, unknown>) => ['expenses', 'list', filters] as const,
  detail: (id: string) => ['expenses', 'detail', id] as const,
  categories: ['expenses', 'categories'] as const,
}
```

**Step 4: Write tests and commit**

---

### Task 7 (Track G): Cash Movements Queries + API (Ledger)

**Files:**
- Create: `src/db/queries/cash-movements.ts`
- Create: `src/app/api/financial/ledger/route.ts`
- Create: `src/app/api/financial/practitioner-pl/route.ts`
- Modify: `src/hooks/queries/query-keys.ts`
- Create: `src/hooks/queries/use-ledger.ts`
- Create: `src/hooks/queries/use-practitioner-pl.ts`
- Test: `src/db/queries/__tests__/cash-movements.test.ts`

**Step 1: Implement DB queries** (`src/db/queries/cash-movements.ts`):

Functions:
- `listCashMovements(tenantId, filters)` — paginated chronological list with running balance calculation, joins to patient/category
- `getLedgerSummary(tenantId, dateFrom, dateTo)` — total inflows, outflows, net, overdue receivables
- `getPractitionerPL(tenantId, dateFrom, dateTo, practitionerId?)` — dual attribution model:
  - Revenue Generated: sum of `financial_entries.totalAmount` grouped by procedure creation date (accrual)
  - Revenue Collected: sum of `payment_records.amount` grouped by payment date (cash)
  - Procedures count, average ticket, by procedure type
- `exportLedgerCSV(tenantId, filters)` — returns all movements for CSV generation

**Step 2: Implement API routes**

`/api/financial/ledger` (GET) — roles: owner, financial, receptionist
`/api/financial/practitioner-pl` (GET) — roles: owner, financial (all), practitioner (self only)

**Step 3: Add hooks**

**Step 4: Write tests and commit**

---

## PHASE 3: Client Layer

**Depends on Phase 2 completion (all APIs exist).**

---

### Task 8 (Track H): Financial Settings UI

**Files:**
- Create: `src/components/financial/settings/financial-settings-form.tsx`
- Create: `src/components/financial/settings/expense-categories-manager.tsx`
- Create: `src/components/financial/settings/penalty-preview.tsx`
- Modify: `src/app/(platform)/configuracoes/settings-page-client.tsx` (add Financeiro section)
- Modify: `src/app/(platform)/configuracoes/configuracoes-page-client.tsx` (add hook)
- Test: `src/components/financial/settings/__tests__/financial-settings-form.test.tsx`
- Test: `src/components/financial/settings/__tests__/penalty-preview.test.tsx`

**Components:**

1. **`financial-settings-form.tsx`** — Fine type toggle (percentage/fixed), fine value input, interest rate input, grace period input, bank account fields, PIX fields, defaults. Live penalty preview.

2. **`expense-categories-manager.tsx`** — List with drag-to-reorder (use native HTML drag), add custom category with icon picker (lucide icon name select), edit/delete custom, system defaults show lock icon.

3. **`penalty-preview.tsx`** — Given fine type/value, interest rate, grace period, shows: "Para uma parcela de R$1.000 vencida ha 30 dias: multa R$20 + juros R$10 = R$1.030". Updates live as inputs change. Uses pure functions from `src/lib/financial/penalties.ts`.

**Tests:**
- Penalty preview renders correct calculations
- Settings form submits correct data
- Category manager renders system + custom categories

**Commit after tests pass.**

---

### Task 9 (Track I): Enhanced A Receber Tab

**Files:**
- Modify: `src/components/financial/financial-list.tsx` (heavy rewrite)
- Modify: `src/components/financial/installment-table.tsx` (heavy rewrite)
- Modify: `src/components/financial/payment-form.tsx` (minor — add defaults from settings)
- Create: `src/components/financial/partial-payment-dialog.tsx`
- Create: `src/components/financial/renegotiation-dialog.tsx`
- Create: `src/components/financial/bulk-action-bar.tsx`
- Create: `src/components/financial/penalty-badge.tsx`
- Test: `src/components/financial/__tests__/partial-payment-dialog.test.tsx`
- Test: `src/components/financial/__tests__/renegotiation-dialog.test.tsx`
- Test: `src/components/financial/__tests__/bulk-action-bar.test.tsx`
- Test: `src/components/financial/__tests__/penalty-badge.test.tsx`
- Test: `src/components/financial/__tests__/financial-list.test.tsx`

**Components:**

1. **`financial-list.tsx`** rewrite:
   - Add checkbox column for selection
   - Add filters: status dropdown (add renegotiated), isOverdue toggle, isPartial toggle, patient, date range, payment method
   - Filter persistence in URL search params
   - Show penalty amounts inline (fine + interest badges)
   - Show renegotiation links ("Renegociado → #X" or "Renegociacao de #Y, #Z")
   - Floating `BulkActionBar` when items selected

2. **`installment-table.tsx`** rewrite:
   - Show `payment_records` history per installment (expandable)
   - Show Art. 354 allocation breakdown per payment
   - Show computed penalties (fine + interest) for overdue
   - "Registrar Pagamento" opens `PartialPaymentDialog` (supports any amount)
   - Show `amountPaid` progress bar
   - Show snapshotted rates

3. **`partial-payment-dialog.tsx`**:
   - Amount input (defaults to total due including penalties)
   - Payment method select
   - Optional date picker (for backdated payments, defaults to now)
   - Shows Art. 354 allocation preview before confirming
   - Notes field
   - Calls `recordPayment` mutation

4. **`renegotiation-dialog.tsx`**:
   - Summary table of selected charges with remaining balance breakdown
   - Total consolidation amount
   - Waive penalties toggle + waive amount input
   - New installment count input
   - New description input (pre-filled)
   - Calls `renegotiate` mutation

5. **`bulk-action-bar.tsx`**:
   - Fixed bottom bar, appears when checkboxes selected
   - "Marcar como pago (N)" + "Cancelar (N)" + "Renegociar (N)" buttons
   - Payment method dialog for bulk pay

6. **`penalty-badge.tsx`**:
   - Small badge showing "Multa R$20 + Juros R$10" or just the total
   - Color-coded (amber for pending penalties, green if all covered)

**Tests cover:**
- Partial payment dialog shows correct Art. 354 preview
- Renegotiation dialog calculates consolidated total
- Bulk action bar appears/hides with selection
- Penalty badge renders correct amounts
- Financial list filters work (mock API responses)

**Commit after tests pass.**

---

### Task 10 (Track J): Despesas Tab

**Files:**
- Create: `src/components/financial/expenses/expense-list.tsx`
- Create: `src/components/financial/expenses/expense-form.tsx`
- Create: `src/components/financial/expenses/expense-detail.tsx`
- Create: `src/components/financial/expenses/expense-attachment-upload.tsx`
- Modify: `src/app/(platform)/financeiro/financeiro-page-client.tsx` (add tab)
- Test: `src/components/financial/expenses/__tests__/expense-list.test.tsx`
- Test: `src/components/financial/expenses/__tests__/expense-form.test.tsx`

**Components:**

1. **`expense-list.tsx`** — Paginated table with category icon, description, total, paid count, status. Filters: status, category, date range, payment method, isOverdue toggle. Expandable rows show installments. "Nova Despesa" button.

2. **`expense-form.tsx`** — Dialog: category select (from useExpenseCategories), description, total amount (BRL masked), installment count, custom due dates toggle, optional notes. Installment preview with amounts and dates.

3. **`expense-detail.tsx`** — Expanded view: installments table with pay button, attachment list, cancel button.

4. **`expense-attachment-upload.tsx`** — File upload to Supabase Storage, shows existing attachments with download links and delete buttons.

**Tests cover:**
- Expense form validates and shows installment preview
- Expense list renders with filters
- Attachment upload/delete UI

**Commit after tests pass.**

---

### Task 11 (Track K): Extrato Tab (Ledger)

**Files:**
- Create: `src/components/financial/ledger/ledger-view.tsx`
- Create: `src/components/financial/ledger/ledger-summary-cards.tsx`
- Create: `src/components/financial/ledger/ledger-export.tsx`
- Modify: `src/app/(platform)/financeiro/financeiro-page-client.tsx` (add tab)
- Test: `src/components/financial/ledger/__tests__/ledger-view.test.tsx`

**Components:**

1. **`ledger-view.tsx`** — Chronological timeline from `cash_movements`. Each row: date, type icon (arrow up green / arrow down red), description, patient or category, payment method, amount, running balance. Filters: movement type, date range, payment method, patient, category. Pagination.

2. **`ledger-summary-cards.tsx`** — 4 cards: Total Inflows, Total Outflows, Net Result, Overdue Receivables. Date range filtered.

3. **`ledger-export.tsx`** — CSV download button. Fetches all movements for current filters and generates client-side CSV.

**Tests:**
- Ledger renders inflows and outflows with correct colors
- Summary cards show correct totals
- Export generates valid CSV

**Commit after tests pass.**

---

### Task 12 (Track L): Por Profissional + Enhanced Visao Geral

**Files:**
- Create: `src/components/financial/practitioner-pl/practitioner-pl-view.tsx`
- Create: `src/components/financial/practitioner-pl/practitioner-card.tsx`
- Modify: `src/components/financial/revenue-chart.tsx` (add expense data, net profit)
- Modify: `src/app/(platform)/financeiro/financeiro-page-client.tsx` (add tab, reorder)
- Test: `src/components/financial/practitioner-pl/__tests__/practitioner-pl-view.test.tsx`
- Test: `src/components/financial/__tests__/revenue-chart.test.tsx`

**Components:**

1. **`practitioner-pl-view.tsx`** — Date range filter, practitioner filter (owner/financial sees all, practitioner sees self). Shows grid of `PractitionerCard` components.

2. **`practitioner-card.tsx`** — Card per practitioner: name, revenue generated (accrual), revenue collected (cash), procedures count, average ticket, procedure type breakdown table.

3. **`revenue-chart.tsx`** update — Add expense data to monthly chart (stacked bars: revenue vs expenses), add net profit card, add expense category donut chart alongside procedure type donut.

**Update `financeiro-page-client.tsx`** — 5 tabs: A Receber | Despesas | Extrato | Por Profissional | Visao Geral

**Tests:**
- Practitioner cards render dual attribution
- Revenue chart shows expense data
- Role-based tab visibility

**Commit after tests pass.**

---

## PHASE 4: Integration

---

### Task 13 (Track M): Patient Detail + Cross-Cutting

**Files:**
- Modify: `src/components/patients/patient-financial-tab.tsx` (enhance with penalties, renegotiation links, partial payments)
- Modify: `src/app/(platform)/financeiro/loading.tsx` (update skeleton for 5 tabs)
- Create: `src/components/financial/__tests__/integration.test.tsx` (cross-component flow tests)
- Test: `src/components/patients/__tests__/patient-financial-tab.test.tsx`

**Changes:**

1. **`patient-financial-tab.tsx`** — Show penalty calculations inline, renegotiation links, use new `PartialPaymentDialog` instead of simple pay button, show payment records history.

2. **Loading skeleton** — Update for 5-tab layout.

3. **Integration tests** — Test full flows:
   - Create charge → record partial payment → verify Art. 354 allocation
   - Create charge → renegotiate → verify new charge created
   - Create expense → pay installment → verify cash_movements entry
   - Verify practitioner P&L reflects procedure attribution

**Commit after tests pass.**

---

## Summary

| Phase | Tracks | Parallelism | Estimated Tasks |
|-------|--------|-------------|-----------------|
| 1 | A, B, C | 3 parallel agents | 3 |
| 2 | D, E, F, G | 4 parallel agents | 4 |
| 3 | H, I, J, K, L | 5 parallel agents | 5 |
| 4 | M | 1 agent | 1 |
| **Total** | | **Max 5 parallel** | **13 tasks** |
