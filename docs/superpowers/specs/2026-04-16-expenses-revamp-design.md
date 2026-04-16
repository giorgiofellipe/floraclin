# Expenses Revamp: Revert Payment, Edit Expense, Always-Visible Dates

## Goal

Make expenses flexible enough for real-world corrections: let users revert an installment payment, edit an existing expense (including total, count, dates), and remove the hidden toggle on the creation form so installment dates are always visible and editable.

## Why

Today the expense flow is write-once: once an installment is paid, the user can't undo a mis-click or a mis-recorded date; once an expense is created, the only way to change anything (amount, count, dates, description) is to cancel and re-create. The creation form also hides per-installment dates behind a toggle, which new users miss.

## Non-Goals

- Refunds / overpayment credits (user can't reduce total below what's already paid — they cancel + recreate if they need that).
- Partial payment of a single installment (installments remain atomic: `pending | paid`).
- Editing the payment method / date of a paid installment without reverting (that is two actions: revert, then re-pay).
- Changing installment **numbers** of paid installments.
- Bulk revert or bulk edit.
- Undoing a revert (no "restore payment" button — to re-pay, use the existing pay flow).

## Architecture

Three independent changes sharing the same transaction pattern:

1. **Revert** — reset a paid installment to `pending`, keep the original `cashMovement`, create a counter `cashMovement` (inflow, linked to original via `reversedByMovementId`), reset the parent expense status if applicable, audit-log the revert. Never delete historical cash movements.

2. **Edit** — paid installments are frozen. The user edits scalar fields (description, category, notes) plus the unpaid half of the installment plan (total, count, dates). On save, the backend validates constraints, updates the expense row, deletes unpaid installments, and re-creates them with the new distribution.

3. **Creation form** — remove the "Definir datas de vencimento manualmente" toggle. Always render one date picker per installment, pre-filled monthly-rolling from today. The existing `customDueDates` API payload is sent on every submission.

All three changes stay within `web/src/db/queries/expenses.ts`, `web/src/validations/expenses.ts`, `web/src/app/api/expenses/**`, `web/src/hooks/mutations/use-expense-mutations.ts`, and `web/src/components/financial/expenses/`.

## Change 1: Desfazer pagamento

### Behavior

When a user reverts a paid installment:

1. Load installment with `SELECT ... FOR UPDATE`, assert `status = 'paid'` (else 400).
2. Assert parent expense is not `cancelled` (else 400 — cancelled expenses are frozen).
3. Create a new `cashMovement` row:
   - `type: 'inflow'`
   - `amount`: same as the original outflow
   - `movementDate`: current timestamp
   - `description`: `"Estorno: Despesa parcela {number}"`
   - `reversedByMovementId`: points at the new row from the **original** cashMovement row (see schema note below)
4. Update the installment: `status = 'pending'`, `paidAt = NULL`, `paymentMethod = NULL`.
5. If the parent expense is `paid`, set it back to `pending`.
6. Audit log: `action='update'`, `entityType='expense_installment'`, `changes: { status: { old: 'paid', new: 'pending' }, paidAt: { old: <prev>, new: null }, paymentMethod: { old: <prev>, new: null } }`. Optional free-text `reason` from the UI is included in the audit log `metadata`.

### Schema note

The current `cashMovements` table does not have a `reversedByMovementId` column (per the `reversePayment` pattern used for financial entries, which has this column on the `paymentRecords` table). To keep the accounting trail clean, add:

- `cashMovements.reversedByMovementId uuid NULL` — nullable FK back to `cashMovements.id`. Set on the **original** outflow row when reverted; points to the new inflow. The inflow's column stays `NULL`. This is a one-line migration.

Alternative considered and rejected: leaving the original cashMovement alone and just creating an unlinked inflow. Rejected because linking the pair is needed to hide reversed pairs from "recent movement" UIs and to reconcile a tenant's net cash flow at a point in time.

### API

```
DELETE /api/expenses/installments/[id]/pay
Body: { reason?: string } (max 500 chars)
Response: { success: true, data: Installment } | { error: string } 400/403/404
Auth: roles 'owner' or 'financial'
```

REST semantics: `POST/PUT ... /pay` creates the payment; `DELETE ... /pay` undoes it.

### UI

- `expense-detail.tsx`: for each **paid** installment, add an overflow menu (3-dot button) next to the "Pago em …" label. Menu has one item: "Desfazer pagamento".
- Clicking opens a small confirmation dialog: title "Desfazer pagamento", body "Isso reverte o pagamento desta parcela e gera um lançamento de estorno.", optional textarea "Motivo (opcional)", buttons "Cancelar" / "Desfazer" (destructive variant).
- On success: toast "Pagamento desfeito"; query invalidates (expenses, financial, dashboard, ledger).

### Edge cases

- Parent expense is `cancelled`: 400 with message "Despesa cancelada".
- Installment already `pending`: 400 with message "Parcela não está paga".
- Concurrent revert: row lock on installment serializes; second call returns 400.
- `reason` exceeds 500 chars: zod validation returns 400.

## Change 2: Edit expense

### Editable fields

| Field | Always | If any installment is paid |
|-------|--------|----------------------------|
| description | ✓ | ✓ |
| categoryId | ✓ | ✓ |
| notes | ✓ | ✓ |
| totalAmount | ✓ | **must be ≥ sum(paid installments)** |
| installmentCount | ✓ | **must be ≥ count(paid installments)** |
| per-installment dueDate | ✓ (unpaid only) | unpaid only — paid installments are frozen |

### Behavior on save

Given the input `{ description, categoryId, notes, totalAmount, installmentCount, unpaidDueDates[] }`:

1. Load expense and lock all its installments `SELECT ... FOR UPDATE`.
2. Assert expense is not `cancelled`.
3. Compute `paidInstallments = installments.filter(i => i.status === 'paid')`, `sumPaid = sum(paidInstallments.amount)`, `paidCount = paidInstallments.length`.
4. Validate:
   - `totalAmount >= sumPaid` (else 400 "Valor menor que o já pago").
   - `installmentCount >= paidCount` (else 400 "Parcelas menor que as já pagas").
   - **Consistency:** `(totalAmount - sumPaid === 0) ⇔ (installmentCount - paidCount === 0)`. Exactly one of these being zero is invalid — you can't have "money remaining but no slots" or "empty slots with no money". Else 400 "Valor e parcelas inconsistentes".
   - `unpaidDueDates.length === installmentCount - paidCount` (else 400).
   - Each date matches `YYYY-MM-DD`.
5. Update expense scalars: `description`, `categoryId`, `notes`, `totalAmount`, `installmentCount`.
6. **Regenerate unpaid installments:**
   - Delete all current unpaid installments (keep paid untouched).
   - Compute `remaining = totalAmount - sumPaid`, `unpaidCount = installmentCount - paidCount`.
   - If `unpaidCount === 0` **and** `remaining === 0`: expense is fully paid → update expense.status = 'paid'. Skip installment creation.
   - Else: `perSlot = floor(remaining * 100 / unpaidCount) / 100`; `firstSlotAmount = perSlot + (remaining - perSlot * unpaidCount)` (handle rounding remainder on first new unpaid slot).
   - Create `unpaidCount` new installment rows with numbers `paidCount + 1 … installmentCount`, amounts distributed as above, due dates from `unpaidDueDates[]`, status `pending`.
7. If `unpaidCount > 0` and expense was `paid`, reset expense.status to `pending`. (Edge case: user added more installments to a fully-paid expense.)
8. Audit log: `action='update'`, `entityType='expense'`, `changes` capturing before/after of all five scalar fields + a summary `{ installmentsRegenerated: N }`.

### API

```
PUT /api/expenses/[id]
Body: { description, categoryId, notes?, totalAmount, installmentCount, unpaidDueDates: string[] }
Response: { success: true, data: Expense } | { error, fieldErrors? } 400/403/404
Auth: roles 'owner' or 'financial'
```

### UI

- `expense-detail.tsx`: new "Editar despesa" button in the expense header (next to the existing "Cancelar despesa"). Hidden if expense is `cancelled`.
- Opens `ExpenseEditDialog` (new component). Layout:
  - **Top section:** description, category, notes (same inputs as creation form).
  - **Middle section:** total (R$ masked input), installment count (1–24 select) — changing either re-runs the distribution preview live.
  - **Paid installments block:** collapsed panel showing locked rows with ✓ badge, "Pago em {date} · {method}". Read-only. Header: "{N} parcelas pagas · R$ {sum}".
  - **Unpaid installments block:** one row per unpaid slot. Columns: number, amount (computed, read-only), due date (date picker, editable).
  - **Validation surfacing:** inline errors below the field ("Valor menor que o já pago"), submit disabled until valid.
  - **Footer:** "Cancelar" / "Salvar alterações" (primary).
- On success: toast "Despesa atualizada"; close dialog; invalidates queries.

### Edge cases

- `totalAmount < sumPaid`: inline error, submit disabled.
- `installmentCount < paidCount`: inline error, submit disabled.
- Setting `installmentCount === paidCount` **and** `totalAmount === sumPaid`: allowed — expense becomes `paid`, no new installments created.
- Setting `installmentCount > paidCount` on an expense that was `paid`: allowed — expense reverts to `pending` and new installments are added. Cash movements from existing paid installments are untouched.
- Changing `categoryId`: existing cashMovements keep their original `expenseCategoryId` (history is not rewritten). Only future movements on this expense use the new category.
- Date validation: YYYY-MM-DD format, no past-date restriction (user may be backfilling).
- Concurrent edit: row lock serializes. Second call that started before the first committed will re-read and re-validate; if constraints are now violated, returns 400.

## Change 3: Creation form — always-visible dates

### Change

`web/src/components/financial/expenses/expense-form.tsx`:

- Remove the `customDueDates` boolean state, the Switch, and the conditional `{customDueDates && …}` block.
- Always render the per-installment date block:
  - One row per installment (1 ≤ n ≤ `installmentCount`).
  - Label: "`{n}ª parcela`" (1ª, 2ª, 3ª, …).
  - Date picker pre-filled monthly-rolling from today (`addDays(today, (n-1) * 30)`).
- When `installmentCount` changes: pad/trim the `dueDates` array, preserving any user-edited dates within range.
- Submission: always include `customDueDates` in the POST payload. The API endpoint for creating expenses already accepts this — no backend change needed.

### Removed state / UI

- `customDueDates: boolean` field from form state.
- The Switch + label row.
- Conditional rendering branch.

### Unchanged

- Default dates logic (monthly rolling).
- Installment preview block (amounts + dates).
- Everything else in `expense-form.tsx`.

## Files Changed

| File | Action |
|------|--------|
| `web/src/db/migrations/manual/0004_cash_movements_reversed_by.sql` | Create — add `reversedByMovementId` nullable FK |
| `web/src/db/schema.ts` | Modify — add `reversedByMovementId` column to `cashMovements` |
| `web/src/db/queries/expenses.ts` | Modify — add `revertExpenseInstallmentPayment`, `updateExpense` |
| `web/src/validations/expenses.ts` | Modify — add `revertExpenseInstallmentSchema`, `updateExpenseSchema` |
| `web/src/app/api/expenses/installments/[id]/pay/route.ts` | Modify — add `DELETE` handler |
| `web/src/app/api/expenses/[id]/route.ts` | Modify — add `PUT` handler |
| `web/src/hooks/mutations/use-expense-mutations.ts` | Modify — add `useRevertExpenseInstallment`, `useUpdateExpense` |
| `web/src/components/financial/expenses/expense-form.tsx` | Modify — remove customDueDates toggle, always-visible dates |
| `web/src/components/financial/expenses/expense-edit-dialog.tsx` | Create — full-edit dialog |
| `web/src/components/financial/expenses/expense-detail.tsx` | Modify — "Editar despesa" button + "Desfazer pagamento" overflow action |

## Testing

- Unit: `revertExpenseInstallmentPayment` happy path, revert when parent was `paid`, revert when one of many unpaid, 400 on already-pending, 400 on cancelled expense.
- Unit: `updateExpense` happy path, reduce-to-paid-equals-complete (expense → paid), reduce below paid (400), add installment to fully-paid expense (status flip), change category only.
- Unit: installment distribution with remainder (R$ 1000 / 3 = 333.33 + 333.33 + 333.34 on first slot).
- Component: `ExpenseEditDialog` renders paid/unpaid blocks correctly, disables submit on invalid state, sends correct payload.
- Component: `expense-form.tsx` always renders dates, no Switch, date array updates with count.
- API: DELETE /pay returns 400 when already pending; PUT /expenses returns 400 when totalAmount < sumPaid; both paths audit-log correctly.

## Risks & Mitigations

- **Cash flow reporting skew while reversals are in-flight.** Mitigation: the counter cashMovement is created in the same transaction as the status flip, so a report snapshot sees either both or neither.
- **Data migration on the new `reversedByMovementId` column.** Mitigation: nullable column, no backfill needed — existing rows stay NULL.
- **Users editing a category and expecting historical cash flow by category to update.** Mitigation: documented in the audit log change ("categoryId changed from X to Y; historical cashMovements retain X"). No UI affordance claiming history is rewritten.
- **Someone paying an installment while an edit is in progress.** Mitigation: `SELECT ... FOR UPDATE` on installments inside the edit transaction.
