# FloraClin Bug Report

Generated: 2026-03-27

---

## 1. Patient Creation

### BUG-001: Patient form does not reset `defaultValues` when switching between edit and create modes (P2)
**File:** `src/components/patients/patient-form.tsx`
**Description:** The `useForm` hook uses `defaultValues` based on the `patient` prop, but React Hook Form does not re-initialize `defaultValues` when props change. If the same `PatientForm` component instance is reused (e.g., Sheet stays mounted), opening the form for a new patient after editing an existing one will show stale data.

### BUG-002: `SelectValue` renders a function as children -- likely wrong API usage (P1)
**File:** `src/components/patients/patient-form.tsx` (lines 149-157, 276-286)
**Description:** `<SelectValue>` receives a render function `{(value: string) => ...}` as children. The standard Radix/shadcn `SelectValue` component does not support render-prop children. This likely renders `[object Object]` or the function source text instead of the mapped label. The same pattern appears in many components throughout the app:
- `src/components/scheduling/appointment-form.tsx` (lines 268, 291, 387)
- `src/components/financial/financial-list.tsx` (lines 96-99)
- `src/components/financial/installment-table.tsx` (lines 188-196)
- `src/components/financial/payment-form.tsx` (lines 100-101)
- `src/components/photos/photo-uploader.tsx` (line 279)
- `src/components/settings/product-list.tsx` (line 159)
- `src/components/anamnesis/anamnesis-form.tsx` (line 209)

If the team has a custom `SelectValue` that supports this pattern, this is not a bug. Otherwise, every Select in the app that maps values to labels is broken and will show raw enum values (e.g., `credit_card` instead of `Cartao de Credito`).

### BUG-003: CPF validation is too lenient (P3)
**File:** `src/validations/patient.ts` (line 17)
**Description:** `cpf: z.string().optional()` allows any string, including invalid CPFs. There is no format validation (e.g., 11 digits, checksum) and no uniqueness check per tenant.

---

## 2. Anamnesis

### BUG-004: Auto-save fires immediately on mount (P2)
**File:** `src/components/anamnesis/anamnesis-form.tsx` (lines 320-330)
**Description:** The `watch()` subscription fires on the initial render with the default values, which triggers `debouncedSave()`. This causes an unnecessary save request on page load even if the user has not made any changes.

### BUG-005: Optimistic locking race condition on first create (P3)
**File:** `src/actions/anamnesis.ts` (lines 40-48)
**Description:** In `upsertAnamnesisAction`, when `expectedUpdatedAt` is `undefined` (first save, no existing anamnesis), the `upsertAnamnesis` function's optimistic lock check is bypassed. This is correct for a create. However, the action calls `getAnamnesis` separately to determine `isCreate`, and then `upsertAnamnesis` calls `getAnamnesis` again internally. Between these two calls, another user could have created the anamnesis, causing the second call to find an existing row and update it without the optimistic lock check. The window is small but exists.

---

## 3. Procedure Planning

### BUG-006: No `revalidatePath` after procedure mutations (P1)
**File:** `src/actions/procedures.ts`
**Description:** None of the procedure actions (`createProcedureAction`, `updateProcedureAction`, `approveProcedureAction`, `executeProcedureAction`, `cancelProcedureAction`) call `revalidatePath`. The client components use `router.refresh()` to work around this, but server-side caches will be stale. Any server component that fetches procedure data will show outdated information until the Next.js cache expires naturally.

### BUG-007: `updateProcedureSchema` makes `patientId` and `procedureTypeId` optional (P2)
**File:** `src/validations/procedure.ts` (line 32)
**Description:** `updateProcedureSchema = createProcedureSchema.partial().extend({id, status})`. This makes `patientId` and `procedureTypeId` optional on update. But `updateProcedureAction` passes the parsed data directly to the DB update. If a client sends an update without `procedureTypeId`, the column could be set to `null`, violating the `NOT NULL` constraint on the schema.

### BUG-008: Default price auto-sum does not handle currency masking correctly for edge cases (P3)
**File:** `src/components/procedures/procedure-form.tsx` (lines 398-432)
**Description:** The auto-sum converts `defaultPrice` (a string like `"150.00"`) via `parseFloat` then back to cents string via `Math.round(sum * 100)` and then `maskCurrency`. Floating-point arithmetic may cause rounding errors (e.g., `0.1 + 0.2 = 0.30000000000000004`), though the `Math.round` mitigates most cases.

---

## 4. Procedure Approval

### BUG-009: Consent check uses `checkConsentStatusAction` which checks by patient+type, NOT by procedure (P2)
**File:** `src/components/procedures/procedure-approval.tsx` (line 258)
**Description:** `refreshConsentStatuses` calls `checkConsentStatusAction(patient.id, s.type)`, which invokes `getLatestConsentForPatientType`. This checks if the patient has *any* consent of that type signed at any time, not whether a consent was signed specifically for *this* procedure. A patient who signed a general consent for a previous procedure would pass the check for a new procedure, even if the new procedure involves different risks.

### BUG-010: Contract interpolation uses accented-stripped Portuguese in labels (P3)
**File:** `src/lib/contract-interpolation.ts` (lines 47-52) and `src/components/procedures/procedure-approval.tsx` (lines 55-60)
**Description:** Payment method labels use unaccented strings: `"Cartao de Credito"`, `"Cartao de Debito"`, `"Transferencia Bancaria"`. The same labels in other parts of the app (e.g., `procedure-form.tsx` line 94, `installment-table.tsx` line 41) correctly use accented characters: `"Cartao de Credito"` vs `"Cartao de Credito"`. This inconsistency means the service contract will display unaccented text.

### BUG-011: `acceptConsentAction` does not use the transaction for the DB insert (P2)
**File:** `src/actions/consent.ts` (lines 142-163)
**Description:** The `withTransaction` wraps `acceptConsent` and `createAuditLog`, but `acceptConsent` in `src/db/queries/consent.ts` (line 154) uses `db.insert(...)` directly (the module-level `db`) rather than accepting and using a transaction parameter. So the consent acceptance insert is NOT part of the transaction. If the audit log insert fails, the consent acceptance is already committed and cannot be rolled back.

---

## 5. Procedure Execution

### BUG-012: `PlanComparison` aggregation key includes unit but split only takes first part (P3)
**File:** `src/components/procedures/procedure-execution.tsx` (line 174)
**Description:** The key is `"productName|quantityUnit"`, but when displaying, `const [productName] = key.split('|')` only extracts the product name. If a product has applications with different units (e.g., both `U` and `mL`), they would appear as separate rows but with the same label, which is confusing but not incorrect.

### BUG-013: No error toast on execution failure (P3)
**File:** `src/components/procedures/procedure-execution.tsx`
**Description:** Need to verify, but the execution form sets `submitError` state on failure but does not use `toast.error()` for user feedback. The error is only shown inline if the error state is rendered in the JSX. This is a design choice but may be missed if the error area is scrolled out of view.

---

## 6. Procedure Cancellation

### BUG-014: Cancellation of approved procedure casts transaction incorrectly (P2)
**File:** `src/actions/procedures.ts` (line 535)
**Description:** `(tx as unknown as typeof db).update(financialEntries)...` uses a dangerous double cast. The `tx` from `withTransaction` is already cast as `typeof db` inside `withTransaction` (see `src/lib/tenant.ts` line 22). This double cast (`as unknown as typeof db`) is redundant but fragile -- if the transaction type changes, this will silently break at runtime rather than failing at compile time.

### BUG-015: Cancellation does not cancel individual installments (P2)
**File:** `src/actions/procedures.ts` (lines 534-548)
**Description:** When cancelling an approved procedure, only the `financialEntries` row status is set to `'cancelled'`. The individual `installments` rows remain with `status: 'pending'`. This means:
- The installment table will still show pending installments for a cancelled entry.
- Revenue overview queries that aggregate by installment status will still count these as pending revenue.
- The "overdue" detection logic will still flag these installments.

---

## 7. Scheduling

### BUG-016: Slot calculation uses hardcoded 30-minute step regardless of duration (P3)
**File:** `src/db/queries/appointments.ts` (line 352)
**Description:** `for (let m = startMinutes; m + durationMin <= endMinutes; m += 30)` always increments by 30 minutes. If `durationMin` is 60, the slots still start every 30 minutes (8:00, 8:30, 9:00...), which can create overlapping slot offers. For example, a 60-min slot at 8:00 and another at 8:30 would overlap. The conflict check prevents double-booking, but the UI will show misleading availability.

### BUG-017: Public booking endpoint has no IP-based rate limiting (P2)
**File:** `src/app/api/book/[slug]/route.ts` (lines 158-180)
**Description:** Rate limiting checks for duplicate bookings from the same phone number in the last 5 minutes. However, an attacker can use different phone numbers to flood the system with fake bookings. There is no IP-based rate limiting, CAPTCHA, or other abuse prevention.

### BUG-018: Online booking slot check is inconsistent with slots endpoint (P3)
**File:** `src/app/api/book/[slug]/route.ts` (line 186) vs `slots/route.ts` (line 76)
**Description:** The booking POST endpoint hardcodes a 30-minute slot duration. The slots GET endpoint also hardcodes 30 minutes. These are consistent, but the internal `getAvailableSlotsAction` (called from platform UI) accepts a `durationMin` parameter. If the platform calendar uses a different duration, the slots shown to internal users and external bookers will differ.

### BUG-019: `updateAppointmentStatusAction` missing try/catch (P2)
**File:** `src/actions/appointments.ts` (lines 184-216)
**Description:** Unlike `createAppointmentAction` and `updateAppointmentAction` which have try/catch blocks, `updateAppointmentStatusAction` has none. If the DB query throws, the error will propagate uncaught to the client as an unhandled server error.

### BUG-020: `deleteAppointmentAction` missing try/catch (P2)
**File:** `src/actions/appointments.ts` (lines 218-237)
**Description:** Same issue as BUG-019. No try/catch around the DB operations.

---

## 8. Financial

### BUG-021: Installment amount rounding can lose or gain pennies (P3)
**File:** `src/db/queries/financial.ts` (lines 44-45)
**Description:** `installmentAmount = Math.floor((data.totalAmount * 100) / data.installmentCount) / 100` and `remainder = Math.round((data.totalAmount - installmentAmount * data.installmentCount) * 100) / 100`. The remainder is added to the first installment. Due to floating-point arithmetic, the total of all installments may not exactly equal `totalAmount`. For example, `100.00 / 3` produces installments of `33.34`, `33.33`, `33.33` = `100.00`, but edge cases with larger values and many installments could drift.

### BUG-022: `payInstallment` does not handle `overdue` status installments (P1)
**File:** `src/db/queries/financial.ts` (line 202)
**Description:** The WHERE clause filters `eq(installments.status, 'pending')`. If an installment has been marked as `'overdue'` (e.g., by a scheduled job), clicking "Marcar como pago" will silently fail -- the query returns no rows and throws `"Parcela nao encontrada ou ja paga"`. The UI only shows the pay button for `inst.status === 'pending'` (installment-table.tsx line 151), so overdue installments cannot be paid at all.

### BUG-023: Dashboard "A RECEBER" card is hardcoded to `R$ 0` (P2)
**File:** `src/components/dashboard/quick-stats.tsx` (lines 47-55)
**Description:** The "A RECEBER" (receivable) card always shows `R$ 0` with an empty sublabel. The actual pending/overdue amounts from the financial queries are never passed to this component.

### BUG-024: `FinancialSummary` uses hardcoded placeholder values (P2)
**File:** `src/components/dashboard/financial-summary.tsx` (lines 15-16)
**Description:** `receivable` and `expenses` are both hardcoded to `0`. The "Lucro liquido" (net profit) is therefore always equal to "Recebido", making these cards misleading.

### BUG-025: Revenue overview does not filter by practitioner even when passed (P2)
**File:** `src/db/queries/financial.ts` (lines 259-345)
**Description:** The `getRevenueOverview` function accepts a `practitionerId` parameter but never uses it in any query conditions. When a practitioner requests the revenue overview, they see clinic-wide financial data instead of their own.

---

## 9. Dashboard

### BUG-026: Dashboard hardcodes "Dra." title prefix (P2)
**File:** `src/app/(platform)/dashboard/page.tsx` (line 57)
**Description:** `{greeting}, Dra. {firstName}` hardcodes the "Dra." prefix. This is incorrect for male practitioners ("Dr.") or non-doctor staff (receptionists, financial roles).

### BUG-027: Dashboard `recentActivity` is not filtered by practitioner role (P3)
**File:** `src/db/queries/dashboard.ts` (lines 218-239)
**Description:** `getRecentActivity` does not accept or use a `practitionerId` filter. Even when a practitioner is logged in, they see all audit log activity across the clinic, not just their own.

### BUG-028: Dashboard `overdueCount` is always `0` (P2)
**File:** `src/app/(platform)/dashboard/page.tsx` (line 39)
**Description:** `const overdueCount: number = 0` is a hardcoded placeholder. The overdue payment badge and count are never populated from actual data, so overdue payments are invisible on the dashboard.

---

## 10. Settings

### BUG-029: `Product` interface in product-list.tsx is missing `showInDiagram` (P1)
**File:** `src/components/settings/product-list.tsx` (lines 63-70)
**Description:** The `Product` interface does not include `showInDiagram`, but the component references `product.showInDiagram` on lines 246, 248, and 324. TypeScript will report this as an error (accessing a property that does not exist on the type). At runtime, the value will be `undefined`, so the Switch will always show as unchecked, and toggling will pass `!undefined === true` as the new value.

### BUG-030: Product list does not refresh after mutations (P2)
**File:** `src/components/settings/product-list.tsx`
**Description:** The `ProductList` component receives `initialProducts` as a prop and never refreshes. After creating, editing, toggling, or deleting a product, the list is not updated. The actions call `revalidatePath('/configuracoes')`, which would refresh a server component, but the `ProductList` is a client component that holds its own state from the initial prop. The user must manually reload the page.

### BUG-031: `ProductFormDialog` `onSuccess` closes dialog but does not trigger page refresh (P2)
**File:** `src/components/settings/product-list.tsx` (lines 375-389)
**Description:** The create dialog's `onSuccess` sets `setCreateOpen(false)`, and the edit dialog's `onSuccess` sets `setEditingProduct(null)`. Neither triggers a `router.refresh()` or state update to re-fetch the product list.

---

## Common Issues

### BUG-032: Dynamic imports of `@/db/schema` and `@/db/client` in server actions (P3)
**File:** `src/actions/appointments.ts` (lines 269-271, 299-301)
**Description:** `listPatientsForSelectAction` and `listProcedureTypesForSelectAction` use `await import(...)` for `@/db/schema`, `@/db/client`, and `drizzle-orm`. These are server actions (marked `'use server'`), so dynamic imports are unnecessary -- static imports would work fine and are more efficient. While not a bug per se, this pattern bypasses tree-shaking and adds latency.

### BUG-033: Missing accents/special characters in several UI strings (P3)
**Files:** Multiple components
**Description:** Several user-facing strings are missing Portuguese diacritics:
- `procedure-approval.tsx`: "Contrato de Servico" (should be "Servico"), "Assinatura do paciente (obrigatoria)" (should be "obrigatoria"), "Li e concordo com os termos do contrato de prestacao de servicos"
- `financial-list.tsx`: "Descricao" (should be "Descricao"), "Pagina X de Y" (should be "Pagina"), "Proxima" (should be "Proxima")
- `installment-table.tsx`: "metodo de pagamento" (should be "metodo")
- `photo-uploader.tsx`: "Estagio" (should be "Estagio")
- These appear to be intentional plain-ASCII choices in some cases, but they are inconsistent with the rest of the app which uses proper accented Portuguese.

### BUG-034: `listConsentTemplates` returns grouped object but `ConsentTemplateList` expects flat array (P2)
**File:** `src/db/queries/consent.ts` (line 41) vs `src/components/settings/consent-template-list.tsx` (line 38)
**Description:** `listConsentTemplates` returns `Record<string, Template[]>` (grouped by type). But `ConsentTemplateListProps` expects `templates: ConsentTemplate[]` (flat array). The settings page passes the result of `listConsentTemplatesAction()` directly, which returns the grouped object. The component then tries to iterate with `.reduce()` (line 53) over what it expects to be an array. This will either throw at runtime or produce unexpected results.

### BUG-035: `useEffect` in `InstallmentTable` missing `entryId` in eslint deps (P3)
**File:** `src/components/financial/installment-table.tsx` (lines 73-75)
**Description:** `useEffect(() => { loadInstallments() }, [entryId])` -- the dependency array includes `entryId` but not `loadInstallments`. While `loadInstallments` is defined inside the component and references `entryId` in its closure, React's exhaustive-deps rule would flag this. In practice, it works because `entryId` changes trigger the effect, but `loadInstallments` identity is not stable (no `useCallback`).

### BUG-036: No error handling in `handleStatusChange` and `handleDelete` in appointment form (P2)
**File:** `src/components/scheduling/appointment-form.tsx` (lines 185-198)
**Description:** Both `handleStatusChange` and `handleDelete` call server actions without try/catch and without checking the return value for errors. If the action fails, the dialog closes (`onOpenChange(false)`) and `onSaved?.()` is called, giving the user false confidence that the operation succeeded.

### BUG-037: `consent.ts` action `acceptConsentAction` uses `getAuthContext` instead of `requireRole` (P3)
**File:** `src/actions/consent.ts` (line 128)
**Description:** `acceptConsentAction` uses `getAuthContext()` which allows any authenticated user. Most mutation actions use `requireRole()` to restrict access. A user with `'receptionist'` or `'financial'` role can accept consents on behalf of patients, which may not be intended.

### BUG-038: Procedure `getProcedureAction` uses `getAuthContext` with no role check (P3)
**File:** `src/actions/procedures.ts` (line 253)
**Description:** `getProcedureAction` uses `getAuthContext()`, meaning any logged-in user with tenant access can view procedure details. This may be intentional but is inconsistent with `createProcedureAction` and `updateProcedureAction` which require `owner` or `practitioner` roles.

### BUG-039: `MaskedInput` `onChange` handler receives the event but the `mask` function is applied to `value` (P3)
**File:** `src/components/patients/patient-form.tsx` (line 203) and `src/components/financial/payment-form.tsx` (line 142)
**Description:** In the payment form, `onChange={(e) => handleAmountChange(e.target.value)}` passes `e.target.value` which is the *already masked* value from `MaskedInput`. Then `handleAmountChange` calls `maskCurrency(value)` again, double-masking the input. Whether this causes visible issues depends on how `maskCurrency` handles already-formatted strings. Since `maskCurrency` strips non-digits first, the double-mask may work, but it processes the string twice unnecessarily.

### BUG-040: `procedure-approval.tsx` has a dependency array issue in the contract loading useEffect (P2)
**File:** `src/components/procedures/procedure-approval.tsx` (lines 275-322)
**Description:** The `useEffect` for loading the service contract has dependencies `[selectedTypes, productTotals, financialPlan, patient, procedure.practitionerName, tenant.name]`. Since `selectedTypes` is a filtered array derived from `procedureTypes` state, it creates a new array reference on every render, causing this effect to fire repeatedly. This results in multiple unnecessary API calls to load the contract template.

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| P1       | 3     | Critical: payInstallment ignores overdue, Product interface missing field, SelectValue render-prop pattern |
| P2       | 16    | Major: missing revalidatePath, missing error handling, hardcoded values, data inconsistencies |
| P3       | 14    | Minor: validation gaps, missing accents, performance issues, minor inconsistencies |
| **Total**| **33**| |

### Top Priority Fixes
1. **BUG-002**: Verify if the custom `SelectValue` supports render-prop children. If not, every Select dropdown in the app is broken.
2. **BUG-022**: Allow paying overdue installments (change WHERE clause to include `'overdue'` status).
3. **BUG-006**: Add `revalidatePath` calls to procedure actions.
4. **BUG-029**: Add `showInDiagram` to the `Product` interface.
5. **BUG-015**: Cancel installments when cancelling an approved procedure.
6. **BUG-034**: Fix consent template list data shape mismatch.
