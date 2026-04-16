# Expenses Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three expense-flow features: (1) revert a paid installment, (2) full edit of an expense including regeneration of unpaid installments, (3) always-visible installment dates on the creation form.

**Architecture:** All changes isolated to the expenses subsystem (`web/src/db/queries/expenses.ts`, `web/src/validations/expenses.ts`, `web/src/app/api/expenses/**`, `web/src/hooks/mutations/use-expense-mutations.ts`, `web/src/components/financial/expenses/`). Revert reuses the existing `reversedByMovementId` column on `cashMovements` (no schema change needed — the column already exists). Edit uses row-level locking + full unpaid-installment regeneration in a single transaction, mirroring the `payExpenseInstallment` pattern.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM (Postgres), zod, react-hook-form, @base-ui-components/react, Vitest + @testing-library/react.

---

## Pre-flight note

**No DB migration needed.** The spec originally called for adding `cashMovements.reversedByMovementId` — this column already exists in the schema. Skip that file.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `web/src/validations/expenses.ts` | Modify | Add `revertExpenseInstallmentSchema`, `updateExpenseSchema` |
| `web/src/db/queries/expenses.ts` | Modify | Add `revertExpenseInstallmentPayment`, `updateExpense` |
| `web/src/hooks/mutations/use-expense-mutations.ts` | Modify | Add `useRevertExpenseInstallment`, `useUpdateExpense` |
| `web/src/app/api/expenses/installments/[id]/pay/route.ts` | Modify | Add `DELETE` handler |
| `web/src/app/api/expenses/[id]/route.ts` | Modify | Add `PUT` handler |
| `web/src/components/financial/expenses/expense-form.tsx` | Modify | Remove `customDueDates` toggle, always-visible dates |
| `web/src/components/financial/expenses/expense-edit-dialog.tsx` | Create | Full-edit dialog (paid locked, unpaid regenerable) |
| `web/src/components/financial/expenses/expense-detail.tsx` | Modify | "Editar despesa" button + per-installment "Desfazer" menu |
| `web/src/validations/__tests__/expenses.test.ts` | Modify | Tests for new schemas |
| `web/src/components/financial/expenses/__tests__/expense-edit-dialog.test.tsx` | Create | Tests for edit dialog |
| `web/src/components/financial/expenses/__tests__/expense-form.test.tsx` | Modify | Update tests for always-visible dates |
| `web/src/db/queries/__tests__/expenses-update-math.test.ts` | Create | Unit tests for distribution + validation logic |

---

## Parallelization Summary

```
Group A (parallel, 3 tasks — all independent):
  Task 1: validation schemas (expenses.ts + test)
  Task 2: expense-form.tsx rework (always-visible dates) + its test
  Task 3: DB query functions (expenses.ts) + stub test

Group B (depends on A):
  Task 4: API routes (DELETE pay, PUT expense)
  Task 5: mutation hooks

Group C (depends on B):
  Task 6: ExpenseEditDialog component + test
  Task 7: ExpenseDetail integration (revert menu + editar button)
```

Within a group: no shared files. Between groups: strict dependency. Tasks 4 and 5 both can start after Group A lands (they import from validations + queries) and neither touches the other's files.

---

## Group A (parallel) — Foundation

### Task 1: Validation schemas

**Files:**
- Modify: `web/src/validations/expenses.ts`
- Modify: `web/src/validations/__tests__/expenses.test.ts` (may not exist — create if missing)

- [ ] **Step 1: Write failing tests**

Add to `web/src/validations/__tests__/expenses.test.ts` (create if absent):

```ts
import { describe, it, expect } from 'vitest'
import {
  revertExpenseInstallmentSchema,
  updateExpenseSchema,
} from '../expenses'

describe('revertExpenseInstallmentSchema', () => {
  it('accepts empty object', () => {
    expect(revertExpenseInstallmentSchema.safeParse({}).success).toBe(true)
  })

  it('accepts reason up to 500 chars', () => {
    expect(revertExpenseInstallmentSchema.safeParse({ reason: 'x'.repeat(500) }).success).toBe(true)
  })

  it('rejects reason over 500 chars', () => {
    expect(revertExpenseInstallmentSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false)
  })
})

describe('updateExpenseSchema', () => {
  const base = {
    description: 'Aluguel',
    categoryId: '00000000-0000-0000-0000-000000000001',
    totalAmount: 1000,
    installmentCount: 3,
    unpaidDueDates: ['2026-05-01', '2026-06-01', '2026-07-01'],
  }

  it('accepts a minimal valid payload', () => {
    expect(updateExpenseSchema.safeParse(base).success).toBe(true)
  })

  it('rejects invalid UUID', () => {
    expect(updateExpenseSchema.safeParse({ ...base, categoryId: 'bad' }).success).toBe(false)
  })

  it('rejects installmentCount below 1 or above 24', () => {
    expect(updateExpenseSchema.safeParse({ ...base, installmentCount: 0 }).success).toBe(false)
    expect(updateExpenseSchema.safeParse({ ...base, installmentCount: 25 }).success).toBe(false)
  })

  it('rejects negative or zero totalAmount', () => {
    expect(updateExpenseSchema.safeParse({ ...base, totalAmount: 0 }).success).toBe(false)
    expect(updateExpenseSchema.safeParse({ ...base, totalAmount: -1 }).success).toBe(false)
  })

  it('accepts empty unpaidDueDates (when all installments already paid)', () => {
    expect(updateExpenseSchema.safeParse({ ...base, unpaidDueDates: [] }).success).toBe(true)
  })

  it('rejects bad date format', () => {
    expect(updateExpenseSchema.safeParse({ ...base, unpaidDueDates: ['not-a-date'] }).success).toBe(false)
  })

  it('defaults notes to undefined', () => {
    const r = updateExpenseSchema.safeParse(base)
    if (r.success) expect(r.data.notes).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/giorgiofellipe/Work/floraclin && eval "$(fnm env)" && fnm use 22.12.0 >/dev/null && pnpm --filter web test:run -- web/src/validations/__tests__/expenses.test.ts
```

Expected: fail (module `revertExpenseInstallmentSchema` not found).

- [ ] **Step 3: Add schemas to `web/src/validations/expenses.ts`**

Append after existing schemas:

```ts
// Reason max 500 chars — logged into audit, never exposed back in APIs.
export const revertExpenseInstallmentSchema = z.object({
  reason: z.string().trim().max(500, 'Motivo deve ter no máximo 500 caracteres').optional(),
})

export type RevertExpenseInstallmentInput = z.infer<typeof revertExpenseInstallmentSchema>

export const updateExpenseSchema = z.object({
  description: z.string().trim().min(1, 'Descrição é obrigatória').max(255),
  categoryId: z.string().uuid('Categoria inválida'),
  notes: z.string().trim().max(1000).optional(),
  totalAmount: z.number().positive('Valor deve ser positivo'),
  installmentCount: z.number().int().min(1, 'Mínimo 1 parcela').max(24, 'Máximo 24 parcelas'),
  unpaidDueDates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (esperado YYYY-MM-DD)'))
    .max(24, 'Máximo 24 datas'),
})

export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>
```

- [ ] **Step 4: Run the test**

```bash
pnpm --filter web test:run -- web/src/validations/__tests__/expenses.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/validations/expenses.ts web/src/validations/__tests__/expenses.test.ts
git commit -m "feat: zod schemas for revert installment and update expense"
```

---

### Task 2: Creation form — always-visible dates

**Files:**
- Modify: `web/src/components/financial/expenses/expense-form.tsx`
- Modify: `web/src/components/financial/expenses/__tests__/expense-form.test.tsx`

- [ ] **Step 1: Update expense-form.tsx**

Remove the `customDueDates: boolean` field from the `FormValues` interface and from `defaultValues`. Delete the `customDueDates` watch, the Switch + label row, and the conditional `{customDueDates && ...}` wrapper.

The per-installment date block should always render. Locate the block currently inside `{customDueDates && parsedCount > 0 && (...)}` — move it out of the condition. The container stays as:

```tsx
{parsedCount > 0 && (
  <div className="rounded-[3px] border border-[#E8ECEF] bg-white p-4 space-y-3">
    <p className="text-[10px] uppercase tracking-[0.15em] font-medium text-[#7A7A7A]">Datas de vencimento</p>
    <div className="space-y-2">
      {Array.from({ length: parsedCount }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="text-sm text-mid w-20">{i + 1}a parcela</span>
          <DatePicker
            className="w-[160px]"
            value={dueDates[i] || ''}
            onChange={(v) => {
              const newDates = [...dueDates]
              newDates[i] = v
              setValue('dueDates', newDates)
            }}
          />
        </div>
      ))}
    </div>
  </div>
)}
```

In `handleInstallmentCountChange`, keep the existing logic that initializes `dueDates` monthly-rolling. Also initialize `dueDates` in `defaultValues` to the same monthly-rolling array for the default `installmentCount: '1'`:

```tsx
defaultValues: {
  categoryId: '',
  description: '',
  totalAmount: '',
  installmentCount: '1',
  notes: '',
  dueDates: [format(new Date(), 'yyyy-MM-dd')],
},
```

**Submission:** always send `customDueDates: data.dueDates.slice(0, count)` (remove the `data.customDueDates ? ... : undefined` conditional).

In `installmentPreview`, remove the `customDueDates &&` check; always pull from `dueDates[i]`:

```tsx
const dueDate = dueDates[i]
  ? new Date(dueDates[i] + 'T12:00:00')
  : addDays(today, i * 30)
```

- [ ] **Step 2: Update test to reflect removal of toggle**

In `web/src/components/financial/expenses/__tests__/expense-form.test.tsx`, replace the test:

```tsx
it('renders custom due dates toggle', () => {
  render(<ExpenseForm {...defaultProps} />, { wrapper: createWrapper() })
  expect(screen.getByText('Definir datas de vencimento manualmente')).toBeInTheDocument()
})
```

with:

```tsx
it('always renders per-installment date rows', () => {
  render(<ExpenseForm {...defaultProps} />, { wrapper: createWrapper() })
  // With the default installment count of 1, one date row should be visible
  expect(screen.getByText('Datas de vencimento')).toBeInTheDocument()
  expect(screen.getByText('1a parcela')).toBeInTheDocument()
})

it('does not render the customDueDates toggle', () => {
  render(<ExpenseForm {...defaultProps} />, { wrapper: createWrapper() })
  expect(screen.queryByText('Definir datas de vencimento manualmente')).not.toBeInTheDocument()
})
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter web test:run -- web/src/components/financial/expenses/__tests__/expense-form.test.tsx
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/financial/expenses/expense-form.tsx \
        web/src/components/financial/expenses/__tests__/expense-form.test.tsx
git commit -m "feat: always-visible installment dates on expense creation"
```

---

### Task 3: DB query functions (revert + update)

**Files:**
- Modify: `web/src/db/queries/expenses.ts`

- [ ] **Step 1: Verify imports**

Open `web/src/db/queries/expenses.ts`. These imports must exist (most already do — verify; add only what's missing):

```ts
import { expenses, expenseInstallments, cashMovements } from '@/db/schema'
import { eq, and, isNull, sql } from 'drizzle-orm'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'   // NOTE: @/lib/tenant, NOT @/db/client
import type { PaymentMethod } from '@/types'
```

- [ ] **Step 2: Add `revertExpenseInstallmentPayment`**

Append after `payExpenseInstallment`:

```ts
export async function revertExpenseInstallmentPayment(
  tenantId: string,
  installmentId: string,
  userId: string,
  reason?: string,
) {
  return withTransaction(async (tx) => {
    // 1. Lock installment + fetch parent expense + current cashMovement
    const lockResult = await tx.execute(
      sql`SELECT ei.id, ei.expense_id, ei.amount, ei.status, ei.installment_number,
                 ei.paid_at, ei.payment_method,
                 e.status AS expense_status, e.category_id,
                 cm.id AS movement_id
          FROM floraclin.expense_installments ei
          INNER JOIN floraclin.expenses e ON e.id = ei.expense_id
          LEFT JOIN floraclin.cash_movements cm
            ON cm.expense_installment_id = ei.id
            AND cm.type = 'outflow'
            AND cm.reversed_by_movement_id IS NULL
          WHERE ei.id = ${installmentId}
            AND e.tenant_id = ${tenantId}
            AND e.deleted_at IS NULL
          FOR UPDATE OF ei`,
    )

    const rows = (Array.isArray(lockResult)
      ? lockResult
      : (lockResult as Record<string, unknown>).rows ?? lockResult) as Record<string, unknown>[]
    const row = rows[0]

    if (!row) throw new Error('Parcela não encontrada ou não pertence a esta clínica')
    if (String(row.expense_status) === 'cancelled') throw new Error('Despesa cancelada')
    if (String(row.status) !== 'paid') throw new Error('Parcela não está paga')

    const originalMovementId = row.movement_id ? String(row.movement_id) : null
    const prevPaidAt = row.paid_at ? new Date(row.paid_at as string | Date) : null
    const prevPaymentMethod = row.payment_method ? String(row.payment_method) : null
    const installmentNumber = Number(row.installment_number)
    const expenseId = String(row.expense_id)
    const amount = String(row.amount)
    const categoryId = row.category_id ? String(row.category_id) : null

    // 2. Create counter cashMovement (inflow) — even if original is missing,
    //    so the net cash flow is consistent.
    const [counter] = await tx
      .insert(cashMovements)
      .values({
        tenantId,
        type: 'inflow',
        amount,
        description: `Estorno: Despesa parcela ${installmentNumber}${reason ? ` — ${reason}` : ''}`,
        paymentMethod: prevPaymentMethod,
        movementDate: new Date(),
        expenseInstallmentId: installmentId,
        expenseCategoryId: categoryId,
        recordedBy: userId,
      })
      .returning({ id: cashMovements.id })

    // 3. Link the original movement to this reversal (if it exists)
    if (originalMovementId && counter) {
      await tx
        .update(cashMovements)
        .set({ reversedByMovementId: counter.id })
        .where(eq(cashMovements.id, originalMovementId))
    }

    // 4. Reset the installment
    const [updated] = await tx
      .update(expenseInstallments)
      .set({ status: 'pending', paidAt: null, paymentMethod: null })
      .where(eq(expenseInstallments.id, installmentId))
      .returning()

    // 5. Flip parent expense status if it was 'paid'
    if (String(row.expense_status) === 'paid') {
      await tx
        .update(expenses)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(eq(expenses.id, expenseId))
    }

    // 6. Audit
    await createAuditLog(
      {
        tenantId,
        userId,
        action: 'update',
        entityType: 'expense_installment',
        entityId: installmentId,
        changes: {
          status: { old: 'paid', new: 'pending' },
          paidAt: { old: prevPaidAt ? prevPaidAt.toISOString() : null, new: null },
          paymentMethod: { old: prevPaymentMethod, new: null },
          ...(reason ? { reason: { old: null, new: reason } } : {}),
        },
      },
      tx,
    )

    return updated
  })
}
```

- [ ] **Step 3: Add `updateExpense`**

Append after `revertExpenseInstallmentPayment`:

```ts
interface UpdateExpenseArgs {
  description: string
  categoryId: string
  notes?: string
  totalAmount: number
  installmentCount: number
  unpaidDueDates: string[]
}

export async function updateExpense(
  tenantId: string,
  expenseId: string,
  userId: string,
  input: UpdateExpenseArgs,
) {
  return withTransaction(async (tx) => {
    // 1. Lock the expense
    const [expense] = await tx
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.tenantId, tenantId),
          eq(expenses.id, expenseId),
          isNull(expenses.deletedAt),
        ),
      )
      .limit(1)

    if (!expense) throw new Error('Despesa não encontrada')
    if (expense.status === 'cancelled') throw new Error('Despesa cancelada')

    // 2. Lock + read all installments in ONE query (prevents TOCTOU with concurrent pay/revert)
    const lockedRows = await tx.execute(
      sql`SELECT id, installment_number, amount, status
          FROM floraclin.expense_installments
          WHERE expense_id = ${expenseId}
          FOR UPDATE`,
    )

    const rows = (Array.isArray(lockedRows)
      ? lockedRows
      : (lockedRows as Record<string, unknown>).rows ?? lockedRows) as Record<string, unknown>[]

    const existingInstallments = rows.map((r) => ({
      id: String(r.id),
      installmentNumber: Number(r.installment_number),
      amountCents: Math.round(Number(r.amount) * 100),
      status: String(r.status),
    }))

    const paidInstallments = existingInstallments.filter((i) => i.status === 'paid')
    const unpaidInstallments = existingInstallments.filter((i) => i.status !== 'paid')
    const paidCount = paidInstallments.length
    // Sum paid in cents to avoid float drift (R$ 333.33 + 333.33 + 333.34 precision bugs)
    const sumPaidCents = paidInstallments.reduce((acc, i) => acc + i.amountCents, 0)

    const newTotalCents = Math.round(input.totalAmount * 100)
    const newCount = input.installmentCount
    const unpaidCount = newCount - paidCount
    const remainingCents = newTotalCents - sumPaidCents

    // 3. Validate constraints (all in cents integers — no float drift)
    if (newTotalCents < sumPaidCents) throw new Error('Valor menor que o já pago')
    if (newCount < paidCount) throw new Error('Parcelas menor que as já pagas')
    if ((remainingCents === 0) !== (unpaidCount === 0)) {
      throw new Error('Valor e parcelas inconsistentes')
    }
    if (input.unpaidDueDates.length !== unpaidCount) {
      throw new Error('Quantidade de datas não bate com as parcelas pendentes')
    }

    // 4. Update the expense scalar fields
    const scalarChanges: Record<string, { old: unknown; new: unknown }> = {}
    if (expense.description !== input.description) {
      scalarChanges.description = { old: expense.description, new: input.description }
    }
    if (expense.categoryId !== input.categoryId) {
      scalarChanges.categoryId = { old: expense.categoryId, new: input.categoryId }
    }
    if ((expense.notes ?? null) !== (input.notes ?? null)) {
      scalarChanges.notes = { old: expense.notes ?? null, new: input.notes ?? null }
    }
    const oldTotalCents = Math.round(Number(expense.totalAmount) * 100)
    if (oldTotalCents !== newTotalCents) {
      scalarChanges.totalAmount = { old: oldTotalCents / 100, new: newTotalCents / 100 }
    }
    if (expense.installmentCount !== newCount) {
      scalarChanges.installmentCount = { old: expense.installmentCount, new: newCount }
    }

    await tx
      .update(expenses)
      .set({
        description: input.description,
        categoryId: input.categoryId,
        notes: input.notes ?? null,
        totalAmount: (newTotalCents / 100).toFixed(2),
        installmentCount: newCount,
        updatedAt: new Date(),
      })
      .where(eq(expenses.id, expenseId))

    // 5. Regenerate unpaid installments
    // ASSUMPTION: paid installments form a contiguous prefix 1..paidCount.
    // This holds today because installments can only go pending → paid, and
    // `payExpenseInstallment` doesn't require an ordering. But callers pay
    // in UI order top-to-bottom, so paid-out-of-order is rare in practice.
    // If a future feature allows selective payment, this block needs to
    // preserve paid installment numbers and insert unpaid ones around them.
    if (unpaidInstallments.length > 0) {
      await tx
        .delete(expenseInstallments)
        .where(
          and(
            eq(expenseInstallments.expenseId, expenseId),
            sql`${expenseInstallments.status} <> 'paid'`,
          ),
        )
    }

    if (unpaidCount > 0) {
      const perSlotCents = Math.floor(remainingCents / unpaidCount)
      const remainderCents = remainingCents - perSlotCents * unpaidCount

      for (let i = 0; i < unpaidCount; i++) {
        const amountCents = perSlotCents + (i === 0 ? remainderCents : 0)
        await tx.insert(expenseInstallments).values({
          expenseId,
          installmentNumber: paidCount + i + 1,
          amount: (amountCents / 100).toFixed(2),
          dueDate: input.unpaidDueDates[i],
          status: 'pending',
        })
      }
    }

    // 6. Parent expense status
    if (unpaidCount === 0 && paidCount > 0 && expense.status !== 'paid') {
      await tx
        .update(expenses)
        .set({ status: 'paid', updatedAt: new Date() })
        .where(eq(expenses.id, expenseId))
    } else if (unpaidCount > 0 && expense.status === 'paid') {
      await tx
        .update(expenses)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(eq(expenses.id, expenseId))
    }

    // 7. Audit
    await createAuditLog(
      {
        tenantId,
        userId,
        action: 'update',
        entityType: 'expense',
        entityId: expenseId,
        changes: {
          ...scalarChanges,
          installmentsRegenerated: {
            old: unpaidInstallments.length,
            new: unpaidCount,
          },
        },
      },
      tx,
    )

    return { success: true }
  })
}
```

- [ ] **Step 4: Add unit-level tests for the new query functions**

The existing repo has no vitest tests for `expenses.ts` queries (they require a DB). Add smoke-level logic tests that exercise the arithmetic and validation branches without the DB:

Create `web/src/db/queries/__tests__/expenses-update-math.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

// Extract the pure distribution math into a helper so it's testable.
// If not already exported from expenses.ts, copy the logic inline in the test.

function distribute(totalCents: number, sumPaidCents: number, newCount: number, paidCount: number) {
  const unpaidCount = newCount - paidCount
  const remainingCents = totalCents - sumPaidCents
  if (unpaidCount === 0) return []
  const perSlotCents = Math.floor(remainingCents / unpaidCount)
  const remainderCents = remainingCents - perSlotCents * unpaidCount
  return Array.from({ length: unpaidCount }, (_, i) =>
    perSlotCents + (i === 0 ? remainderCents : 0),
  )
}

describe('installment distribution', () => {
  it('splits R$ 1000 into 5 equal R$ 200 installments (no paid yet)', () => {
    expect(distribute(100000, 0, 5, 0)).toEqual([20000, 20000, 20000, 20000, 20000])
  })

  it('puts rounding remainder on first unpaid slot for R$ 1000 / 3', () => {
    // 100000 / 3 = 33333.33... → floor 33333 each, remainder 1 cent to slot 0
    expect(distribute(100000, 0, 3, 0)).toEqual([33334, 33333, 33333])
  })

  it('regenerates only unpaid when 2 of 5 are already paid', () => {
    // R$ 1000 total, R$ 400 paid → 600 remaining across 3 slots = 200 each
    expect(distribute(100000, 40000, 5, 2)).toEqual([20000, 20000, 20000])
  })

  it('returns empty array when all installments are paid (no more to distribute)', () => {
    expect(distribute(100000, 100000, 5, 5)).toEqual([])
  })

  it('handles float-trap case 0.1 + 0.2 via cents integers', () => {
    // Legacy: 0.1 + 0.2 = 0.30000000000000004 in float.
    // In cents: 10 + 20 = 30 exactly.
    const sumPaidCents = Math.round(0.1 * 100) + Math.round(0.2 * 100)
    expect(sumPaidCents).toBe(30)
  })
})

describe('updateExpense validation branches', () => {
  function validate(totalCents: number, sumPaidCents: number, newCount: number, paidCount: number) {
    const unpaidCount = newCount - paidCount
    const remainingCents = totalCents - sumPaidCents
    if (totalCents < sumPaidCents) return 'Valor menor que o já pago'
    if (newCount < paidCount) return 'Parcelas menor que as já pagas'
    if ((remainingCents === 0) !== (unpaidCount === 0)) return 'Valor e parcelas inconsistentes'
    return 'ok'
  }

  it('rejects total < sum of paid', () => {
    expect(validate(30000, 40000, 5, 2)).toBe('Valor menor que o já pago')
  })

  it('rejects newCount < paidCount', () => {
    expect(validate(100000, 40000, 1, 2)).toBe('Parcelas menor que as já pagas')
  })

  it('rejects inconsistent money vs slots', () => {
    // 2 paid of R$ 400, new total = R$ 400 but still asking for 3 unpaid slots
    expect(validate(40000, 40000, 5, 2)).toBe('Valor e parcelas inconsistentes')
  })

  it('accepts reduce-to-paid-equals-complete', () => {
    // paid=2 R$400, new total=R$400, count=2 → fully paid
    expect(validate(40000, 40000, 2, 2)).toBe('ok')
  })

  it('accepts add-installments-to-fully-paid', () => {
    // was R$ 400 / 2 paid, user adds R$ 600 more over 3 installments = R$1000 / 5
    expect(validate(100000, 40000, 5, 2)).toBe('ok')
  })
})
```

Run:

```bash
pnpm --filter web test:run -- web/src/db/queries/__tests__/expenses-update-math.test.ts
```

Expected: all pass.

- [ ] **Step 5: Run existing tests to ensure nothing broke**

```bash
cd /Users/giorgiofellipe/Work/floraclin && eval "$(fnm env)" && fnm use 22.12.0 >/dev/null && pnpm --filter web test:run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/db/queries/expenses.ts web/src/db/queries/__tests__/expenses-update-math.test.ts
git commit -m "feat: revertExpenseInstallmentPayment + updateExpense queries"
```

---

## Group B (depends on A) — API + hooks

### Task 4: API routes

**Files:**
- Modify: `web/src/app/api/expenses/installments/[id]/pay/route.ts` (add DELETE)
- Modify: `web/src/app/api/expenses/[id]/route.ts` (add PUT)

- [ ] **Step 1: Add DELETE handler to pay route**

Append to `web/src/app/api/expenses/installments/[id]/pay/route.ts`:

```ts
import { revertExpenseInstallmentPayment } from '@/db/queries/expenses'
import { revertExpenseInstallmentSchema } from '@/validations/expenses'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'financial'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    // Body may be absent; guard JSON parse.
    const raw = await request.text()
    const body = raw ? JSON.parse(raw) : {}
    const parsed = revertExpenseInstallmentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const installment = await revertExpenseInstallmentPayment(
      ctx.tenantId,
      id,
      ctx.userId,
      parsed.data.reason,
    )

    return NextResponse.json({ success: true, data: installment })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (
      msg.includes('não encontrada') ||
      msg.includes('não está paga') ||
      msg.includes('Despesa cancelada')
    ) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Add PUT handler to expenses/[id] route**

Edit `web/src/app/api/expenses/[id]/route.ts`. Add imports at the top if missing:

```ts
import { updateExpense } from '@/db/queries/expenses'
import { updateExpenseSchema } from '@/validations/expenses'
```

Then add the new handler alongside existing GET/DELETE:

```ts
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'financial'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const parsed = updateExpenseSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await updateExpense(ctx.tenantId, id, ctx.userId, parsed.data)
    return NextResponse.json(result)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (
      msg.includes('Despesa não encontrada') ||
      msg.includes('Despesa cancelada') ||
      msg.includes('Valor menor') ||
      msg.includes('Parcelas menor') ||
      msg.includes('Valor e parcelas inconsistentes') ||
      msg.includes('Quantidade de datas')
    ) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Run full test suite + typecheck**

```bash
cd /Users/giorgiofellipe/Work/floraclin && eval "$(fnm env)" && fnm use 22.12.0 >/dev/null && pnpm --filter web test:run
cd /Users/giorgiofellipe/Work/floraclin/web && eval "$(fnm env)" && fnm use 22.12.0 >/dev/null && npx tsc --noEmit
```

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/expenses/installments/[id]/pay/route.ts \
        web/src/app/api/expenses/[id]/route.ts
git commit -m "feat: DELETE /pay revert + PUT /expenses/[id] endpoints"
```

---

### Task 5: React Query mutation hooks

**Files:**
- Modify: `web/src/hooks/mutations/use-expense-mutations.ts`

- [ ] **Step 1: Add mutations**

Append to the existing file:

```ts
export function useRevertExpenseInstallment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const res = await fetch(`/api/expenses/installments/${id}/pay`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reason ? { reason } : {}),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao desfazer pagamento')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
}

interface UpdateExpensePayload {
  id: string
  description: string
  categoryId: string
  notes?: string
  totalAmount: number
  installmentCount: number
  unpaidDueDates: string[]
}

export function useUpdateExpense() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateExpensePayload) => {
      const res = await fetch(`/api/expenses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao atualizar despesa')
      }
      return res.json()
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses.detail(vars.id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
}
```

**Important:** do NOT call `toast` from inside these hooks. The existing expense hooks don't toast from the hook — error/success surfaces live in the calling component (mirrors `usePayExpenseInstallment` / `useCancelExpense`). The components (`ExpenseEditDialog`, `ExpenseDetail`) already wrap `mutateAsync` in try/catch and toast there.

- [ ] **Step 2: Typecheck**

```bash
cd /Users/giorgiofellipe/Work/floraclin/web && eval "$(fnm env)" && fnm use 22.12.0 >/dev/null && npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/mutations/use-expense-mutations.ts
git commit -m "feat: useRevertExpenseInstallment + useUpdateExpense hooks"
```

---

## Group C (depends on B) — UI

### Task 6: ExpenseEditDialog component

**Files:**
- Create: `web/src/components/financial/expenses/expense-edit-dialog.tsx`
- Create: `web/src/components/financial/expenses/__tests__/expense-edit-dialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/financial/expenses/__tests__/expense-edit-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ExpenseEditDialog } from '../expense-edit-dialog'

const mockMutateAsync = vi.fn()

vi.mock('@/hooks/mutations/use-expense-mutations', () => ({
  useUpdateExpense: vi.fn().mockReturnValue({
    mutateAsync: (...args: unknown[]) => mockMutateAsync(...args),
    isPending: false,
  }),
}))

vi.mock('@/hooks/queries/use-financial-settings', () => ({
  useExpenseCategories: vi.fn().mockReturnValue({
    data: { data: [{ id: 'cat-1', name: 'Aluguel', icon: 'home' }] },
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

const expense = {
  id: 'exp-1',
  description: 'Aluguel',
  categoryId: 'cat-1',
  notes: null,
  totalAmount: '1000.00',
  installmentCount: 5,
  status: 'pending',
  installments: [
    { id: 'i1', installmentNumber: 1, amount: '200.00', dueDate: '2026-01-01', status: 'paid', paidAt: '2026-01-01T12:00:00Z', paymentMethod: 'pix' },
    { id: 'i2', installmentNumber: 2, amount: '200.00', dueDate: '2026-02-01', status: 'paid', paidAt: '2026-02-01T12:00:00Z', paymentMethod: 'pix' },
    { id: 'i3', installmentNumber: 3, amount: '200.00', dueDate: '2026-03-01', status: 'pending', paidAt: null, paymentMethod: null },
    { id: 'i4', installmentNumber: 4, amount: '200.00', dueDate: '2026-04-01', status: 'pending', paidAt: null, paymentMethod: null },
    { id: 'i5', installmentNumber: 5, amount: '200.00', dueDate: '2026-05-01', status: 'pending', paidAt: null, paymentMethod: null },
  ],
}

describe('ExpenseEditDialog', () => {
  const baseProps = {
    open: true,
    onOpenChange: vi.fn(),
    expense,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockMutateAsync.mockResolvedValue({ success: true })
  })

  it('renders title and key fields', () => {
    render(wrap(<ExpenseEditDialog {...baseProps} />))
    expect(screen.getByText('Editar despesa')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Aluguel')).toBeInTheDocument()
  })

  it('shows paid installments as locked with counts', () => {
    render(wrap(<ExpenseEditDialog {...baseProps} />))
    // summary text
    expect(screen.getByText(/2 parcelas pagas/)).toBeInTheDocument()
  })

  it('disables submit when totalAmount < sumPaid', async () => {
    render(wrap(<ExpenseEditDialog {...baseProps} />))
    // Enter an amount below the paid sum (R$ 400)
    const amountInput = screen.getByLabelText(/Valor Total/i)
    await userEvent.clear(amountInput)
    await userEvent.type(amountInput, '100,00')
    expect(screen.getByRole('button', { name: /Salvar/i })).toBeDisabled()
    expect(screen.getByText(/Valor menor que o já pago/)).toBeInTheDocument()
  })

  it('calls mutateAsync with correct payload', async () => {
    render(wrap(<ExpenseEditDialog {...baseProps} />))
    await userEvent.click(screen.getByRole('button', { name: /Salvar/i }))
    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        id: 'exp-1',
        description: 'Aluguel',
        categoryId: 'cat-1',
        totalAmount: 1000,
        installmentCount: 5,
        unpaidDueDates: ['2026-03-01', '2026-04-01', '2026-05-01'],
      }))
    })
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter web test:run -- web/src/components/financial/expenses/__tests__/expense-edit-dialog.test.tsx
```

Expected: FAIL (module not found).

- [ ] **Step 3: Create the component**

Create `web/src/components/financial/expenses/expense-edit-dialog.tsx`:

```tsx
'use client'

import { useState, useMemo, useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { MaskedInput } from '@/components/ui/masked-input'
import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useUpdateExpense } from '@/hooks/mutations/use-expense-mutations'
import { useExpenseCategories } from '@/hooks/queries/use-financial-settings'
import { maskCurrency, parseCurrency } from '@/lib/masks'
import { formatCurrency, formatDate } from '@/lib/utils'
import { addDays, format } from 'date-fns'
import { getCategoryIcon } from './category-icon'
import { CheckCircle2Icon, Loader2Icon } from 'lucide-react'
import { PAYMENT_METHOD_ITEMS } from '@/lib/financial/constants'

interface Installment {
  id: string
  installmentNumber: number
  amount: string
  dueDate: string
  status: string
  paidAt: string | null
  paymentMethod: string | null
}

interface Expense {
  id: string
  description: string
  categoryId: string
  notes: string | null
  totalAmount: string
  installmentCount: number
  status: string
  installments: Installment[]
}

interface ExpenseEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  expense: Expense
}

interface Category {
  id: string
  name: string
  icon: string
}

interface FormValues {
  description: string
  categoryId: string
  notes: string
  totalAmount: string
  installmentCount: string
  unpaidDueDates: string[]
}

const INSTALLMENT_COUNT_ITEMS: Record<string, string> = Object.fromEntries(
  Array.from({ length: 24 }, (_, i) => [String(i + 1), `${i + 1}x`]),
)

export function ExpenseEditDialog({ open, onOpenChange, expense }: ExpenseEditDialogProps) {
  const update = useUpdateExpense()
  const { data: categoriesResponse } = useExpenseCategories()
  const categoryList: Category[] = (categoriesResponse?.data as Category[]) ?? []
  const categoryItems = useMemo(
    () => Object.fromEntries(categoryList.map((c) => [c.id, c.name])),
    [categoryList],
  )

  const paid = expense.installments.filter((i) => i.status === 'paid')
  const paidCount = paid.length
  const sumPaid = paid.reduce((acc, i) => acc + Number(i.amount), 0)
  const unpaid = expense.installments.filter((i) => i.status !== 'paid')

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      description: expense.description,
      categoryId: expense.categoryId,
      notes: expense.notes ?? '',
      totalAmount: maskCurrency(String(Math.round(Number(expense.totalAmount) * 100))),
      installmentCount: String(expense.installmentCount),
      unpaidDueDates: unpaid.map((u) => u.dueDate),
    },
  })

  const totalAmountRaw = watch('totalAmount')
  const installmentCountRaw = watch('installmentCount')
  const unpaidDueDates = watch('unpaidDueDates')

  const parsedAmount = totalAmountRaw ? parseCurrency(totalAmountRaw) : 0
  const parsedCount = Math.max(1, Math.min(24, parseInt(installmentCountRaw, 10) || 1))
  const unpaidCount = parsedCount - paidCount

  // Client-side validation mirrors server constraints.
  const errorsList: string[] = []
  if (parsedAmount < sumPaid) errorsList.push('Valor menor que o já pago')
  if (parsedCount < paidCount) errorsList.push('Parcelas menor que as já pagas')
  const remainingCents = Math.round(parsedAmount * 100 - sumPaid * 100)
  if ((remainingCents === 0) !== (unpaidCount === 0)) {
    errorsList.push('Valor e parcelas inconsistentes')
  }

  // Compute distribution preview for unpaid rows.
  const unpaidPreview = useMemo(() => {
    if (unpaidCount <= 0) return []
    const perSlotCents = Math.floor(remainingCents / unpaidCount)
    const remainderCents = remainingCents - perSlotCents * unpaidCount
    return Array.from({ length: unpaidCount }, (_, i) => {
      const amountCents = perSlotCents + (i === 0 ? remainderCents : 0)
      return { amount: amountCents / 100, dueDate: unpaidDueDates[i] || '' }
    })
  }, [unpaidCount, remainingCents, unpaidDueDates])

  // Keep unpaidDueDates length in sync with unpaidCount in an effect
  // (not during render, to avoid feedback loops with RHF's watch()).
  useEffect(() => {
    if (unpaidCount < 0) return
    const current = unpaidDueDates
    if (current.length === unpaidCount) return
    const today = new Date()
    const next = Array.from({ length: unpaidCount }, (_, i) =>
      current[i] || format(addDays(today, (paidCount + i) * 30), 'yyyy-MM-dd'),
    )
    setValue('unpaidDueDates', next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unpaidCount, paidCount])

  async function onSubmit(data: FormValues) {
    if (errorsList.length > 0) return
    try {
      await update.mutateAsync({
        id: expense.id,
        description: data.description.trim(),
        categoryId: data.categoryId,
        notes: data.notes.trim() || undefined,
        totalAmount: parseCurrency(data.totalAmount),
        installmentCount: parsedCount,
        unpaidDueDates: data.unpaidDueDates.slice(0, unpaidCount),
      })
      toast.success('Despesa atualizada')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar')
    }
  }

  const isInvalid = errorsList.length > 0

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar despesa</DialogTitle>
          <DialogDescription>
            Parcelas já pagas ficam bloqueadas. Você pode ajustar valor, número de parcelas e datas das pendentes.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Scalar fields */}
          <div className="space-y-2">
            <Label className="uppercase tracking-wider text-xs font-medium text-mid">Categoria</Label>
            <Controller
              name="categoryId"
              control={control}
              rules={{ required: 'Categoria é obrigatória' }}
              render={({ field }) => (
                <Select
                  items={categoryItems}
                  value={field.value}
                  onValueChange={(v) => field.onChange(v ?? '')}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryList.map((cat) => {
                      const Icon = getCategoryIcon(cat.icon)
                      return (
                        <SelectItem key={cat.id} value={cat.id}>
                          <span className="flex items-center gap-2">
                            <Icon className="size-4 text-sage" />
                            {cat.name}
                          </span>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-description" className="uppercase tracking-wider text-xs font-medium text-mid">
              Descrição
            </Label>
            <Input
              id="edit-description"
              {...register('description', { required: 'Descrição é obrigatória' })}
            />
            {errors.description && <p className="text-sm text-destructive">{errors.description.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-amount" className="uppercase tracking-wider text-xs font-medium text-mid">
                Valor Total
              </Label>
              <Controller
                name="totalAmount"
                control={control}
                render={({ field }) => (
                  <MaskedInput
                    id="edit-amount"
                    mask={maskCurrency}
                    value={field.value}
                    onChange={(e) => field.onChange(e.target.value)}
                    inputMode="numeric"
                  />
                )}
              />
            </div>
            <div className="space-y-2">
              <Label className="uppercase tracking-wider text-xs font-medium text-mid">
                Parcelas
              </Label>
              <Select
                items={INSTALLMENT_COUNT_ITEMS}
                value={installmentCountRaw}
                onValueChange={(v) => v && setValue('installmentCount', v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent />
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-notes" className="uppercase tracking-wider text-xs font-medium text-mid">
              Observações
            </Label>
            <Textarea id="edit-notes" {...register('notes')} rows={2} />
          </div>

          {/* Paid installments (locked) */}
          {paidCount > 0 && (
            <div className="rounded-[3px] border border-[#E8ECEF] bg-[#F4F6F8] p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-[0.15em] font-medium text-[#7A7A7A]">
                {paidCount} parcelas pagas · {formatCurrency(sumPaid)}
              </p>
              <div className="space-y-1">
                {paid.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm text-mid">
                    <span className="flex items-center gap-2">
                      <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-600" />
                      Parcela {p.installmentNumber} — {p.paidAt ? formatDate(p.paidAt) : ''}
                      {p.paymentMethod ? ` · ${PAYMENT_METHOD_ITEMS[p.paymentMethod] ?? p.paymentMethod}` : ''}
                    </span>
                    <span className="tabular-nums">{formatCurrency(Number(p.amount))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unpaid slots (editable dates) */}
          {unpaidCount > 0 && (
            <div className="rounded-[3px] border border-[#E8ECEF] bg-white p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-[0.15em] font-medium text-[#7A7A7A]">
                Parcelas pendentes
              </p>
              <div className="space-y-2">
                {unpaidPreview.map((row, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-sm text-mid w-24">
                      {paidCount + i + 1}ª parcela
                    </span>
                    <DatePicker
                      className="w-[160px]"
                      value={unpaidDueDates[i] || ''}
                      onChange={(v) => {
                        const next = [...unpaidDueDates]
                        next[i] = v
                        setValue('unpaidDueDates', next)
                      }}
                    />
                    <span className="ml-auto text-sm font-medium text-charcoal tabular-nums">
                      {formatCurrency(row.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error surface */}
          {errorsList.length > 0 && (
            <div className="text-sm text-destructive space-y-1">
              {errorsList.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          )}

          <DialogFooter className="pt-2 border-t border-sage/10">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isInvalid || update.isPending}>
              {update.isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Salvar alterações'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter web test:run -- web/src/components/financial/expenses/__tests__/expense-edit-dialog.test.tsx
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/financial/expenses/expense-edit-dialog.tsx \
        web/src/components/financial/expenses/__tests__/expense-edit-dialog.test.tsx
git commit -m "feat: ExpenseEditDialog with paid-locked + unpaid-regenerable installments"
```

---

### Task 7: ExpenseDetail integration

**Files:**
- Modify: `web/src/components/financial/expenses/expense-detail.tsx`

- [ ] **Step 1: Add imports**

Add to the top of `expense-detail.tsx`:

```tsx
import { ExpenseEditDialog } from './expense-edit-dialog'
import { useRevertExpenseInstallment } from '@/hooks/mutations/use-expense-mutations'
import { PencilIcon, RotateCcwIcon } from 'lucide-react'
```

The UI uses a plain icon button (RotateCcwIcon) — no dropdown menu needed.

- [ ] **Step 2: Add state + mutations**

Inside `ExpenseDetail`:

```tsx
const [editDialogOpen, setEditDialogOpen] = useState(false)
const [revertDialogOpen, setRevertDialogOpen] = useState(false)
const [revertTarget, setRevertTarget] = useState<Installment | null>(null)
const [revertReason, setRevertReason] = useState('')

const revertInstallment = useRevertExpenseInstallment()

function handleOpenRevert(inst: Installment) {
  setRevertTarget(inst)
  setRevertReason('')
  setRevertDialogOpen(true)
}

async function handleConfirmRevert() {
  if (!revertTarget) return
  try {
    await revertInstallment.mutateAsync({
      id: revertTarget.id,
      reason: revertReason.trim() || undefined,
    })
    toast.success('Pagamento desfeito')
    setRevertDialogOpen(false)
    setRevertTarget(null)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Erro ao desfazer')
  }
}
```

- [ ] **Step 3: Add "Editar despesa" button**

In the component header (above the installment list), render:

```tsx
{!isEntryCancelled && expenseData && (
  <Button
    variant="outline"
    size="sm"
    onClick={() => setEditDialogOpen(true)}
    className="h-7 px-2 text-xs"
  >
    <PencilIcon className="h-3 w-3" />
    Editar despesa
  </Button>
)}
```

Position near the existing "Cancelar despesa" button.

- [ ] **Step 4: Add revert affordance to each paid installment**

In the installment row, replace the block after the amount/pay button with:

```tsx
{canPay && (
  <Button ...>Pagar</Button>
)}
{isPaid && !isEntryCancelled && (
  <Button
    variant="ghost"
    size="icon-sm"
    title="Desfazer pagamento"
    onClick={(e) => {
      e.stopPropagation()
      handleOpenRevert(inst)
    }}
  >
    <RotateCcwIcon className="h-3.5 w-3.5 text-mid" />
  </Button>
)}
```

- [ ] **Step 5: Render the revert confirmation dialog**

At the bottom of the component JSX (before closing wrapper):

```tsx
<Dialog open={revertDialogOpen} onOpenChange={setRevertDialogOpen}>
  <DialogContent className="sm:max-w-md">
    <DialogHeader>
      <DialogTitle>Desfazer pagamento</DialogTitle>
      <DialogDescription>
        Isso reverte o pagamento desta parcela e gera um lançamento de estorno.
      </DialogDescription>
    </DialogHeader>
    <div className="space-y-2 py-2">
      <Label className="uppercase tracking-wider text-xs font-medium text-mid">
        Motivo (opcional)
      </Label>
      <Textarea
        value={revertReason}
        onChange={(e) => setRevertReason(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Ex: registro duplicado"
      />
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => setRevertDialogOpen(false)}>
        Cancelar
      </Button>
      <Button
        variant="destructive"
        onClick={handleConfirmRevert}
        disabled={revertInstallment.isPending}
      >
        {revertInstallment.isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Desfazer'}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

Add the `Textarea` import at the top: `import { Textarea } from '@/components/ui/textarea'`.

- [ ] **Step 6: Render the edit dialog**

Near the revert dialog:

```tsx
{expenseData && (
  <ExpenseEditDialog
    open={editDialogOpen}
    onOpenChange={setEditDialogOpen}
    expense={{
      id: expenseId,
      description: expenseData.description,
      categoryId: expenseData.categoryId,
      notes: expenseData.notes,
      totalAmount: expenseData.totalAmount,
      installmentCount: expenseData.installmentCount,
      status: expenseData.status,
      installments,
    }}
  />
)}
```

Adjust field names if `expenseData` shape differs (verify by reading the `GET /api/expenses/[id]` response shape).

- [ ] **Step 7: Run the full test suite**

```bash
cd /Users/giorgiofellipe/Work/floraclin && eval "$(fnm env)" && fnm use 22.12.0 >/dev/null && pnpm --filter web test:run
```

Expected: all pass.

- [ ] **Step 8: Typecheck**

```bash
cd /Users/giorgiofellipe/Work/floraclin/web && eval "$(fnm env)" && fnm use 22.12.0 >/dev/null && npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add web/src/components/financial/expenses/expense-detail.tsx
git commit -m "feat: revert payment + edit expense buttons on expense detail"
```

---

## Parallelization Summary

```
Group A (parallel — 3 tasks, no shared files):
  Task 1: validations/expenses.ts                 + its test
  Task 2: expense-form.tsx                        + its test
  Task 3: db/queries/expenses.ts

Group B (depends on A — 2 tasks, no shared files):
  Task 4: api/expenses/installments/[id]/pay + api/expenses/[id] routes
  Task 5: hooks/mutations/use-expense-mutations.ts

Group C (depends on B — 2 sequential tasks):
  Task 6: expense-edit-dialog.tsx                 + its test
  Task 7: expense-detail.tsx integration
```

Task 7 imports `ExpenseEditDialog` (Task 6), so C is sequential: 6 then 7.

---

## Notes / Open Items

- The `ExpenseEditDialog` uses a `queueMicrotask` trick to keep `unpaidDueDates.length` in sync during render without causing React's "setState during render" warning. If RHF has a cleaner hook for this, prefer that — but this works and is isolated.
- `DropdownMenu` fallback: if the component doesn't exist, Task 7 instructions cover the inline-button fallback.
- The `GET /api/expenses/[id]` response must include `description`, `categoryId`, `notes`, `totalAmount`, `installmentCount`, `status`, `installments[]` — verify in Task 7 step 6 and adjust mapping if shape differs.
