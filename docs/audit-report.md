# FloraClin Security & Consistency Audit Report

**Date:** 2026-03-27
**Scope:** Full codebase audit covering `src/db/queries/`, `src/actions/`, `src/app/api/`, and UI components.

---

## CRITICAL

### C1. `switchTenantAction` lacks authorization — tenant takeover risk

**File:** `src/actions/auth.ts:47-49`

The `switchTenantAction` server action accepts an arbitrary `tenantId` and sets it as a cookie without verifying the user is a member of that tenant. Any authenticated user can call `switchTenantAction("victim-tenant-id")` and gain full access to another tenant's data.

```ts
export async function switchTenantAction(tenantId: string) {
  const { setActiveTenant } = await import('@/lib/auth')
  await setActiveTenant(tenantId)  // No membership check!
}
```

While `getAuthContext()` checks the user's memberships, the cookie-based lookup (`activeMembership = memberships.find(m => m.tenantId === selectedTenantId) ?? memberships[0]`) will fall back to the first membership if the cookie value doesn't match -- so the attack would fail silently. However, if the user IS a member of multiple tenants, they can switch to any tenant without server-side membership verification, and the cookie is trusted for tenant selection. A proper fix should validate the target tenant against the user's memberships.

### C2. `updateProcedure` query allows arbitrary status bypass

**File:** `src/db/queries/procedures.ts:117`

The `updateProcedure` query accepts `status` as part of its data payload and writes it directly without checking the current status:

```ts
if (data.status !== undefined) updateData.status = data.status
```

While the action layer (`src/actions/procedures.ts`) uses dedicated lifecycle functions (`approveProcedure`, `executeProcedure`, `cancelProcedure`) with proper guards, the `updateProcedureAction` passes `status` through to `updateProcedure` via the schema. If the `updateProcedureSchema` validation does not reject status changes, a caller could bypass the lifecycle (e.g., set `executed` on a `planned` procedure). This violates the procedure lifecycle invariant at the query level.

### C3. Public booking endpoint has weak rate limiting

**File:** `src/app/api/book/[slug]/route.ts:157-181`

The POST handler uses a phone-number-based duplicate check within a 5-minute window as its only rate limiting mechanism. This is trivially bypassed by:
- Using different phone numbers
- Automated form submissions from different IPs

There is no IP-based rate limiting, CAPTCHA (Turnstile), or proper rate-limiting middleware (despite `express-rate-limit` being in `package-lock.json`). The codebase plan at `docs/plans/2026-03-27-floraclin-mvp-design.md` mentions needing Turnstile CAPTCHA but it is not implemented.

### C4. Booking slots endpoint inconsistent `online_booking_enabled` check

**File:** `src/app/api/book/[slug]/slots/route.ts:64`

The slots route checks `settings.online_booking_enabled === false` (only blocks explicit `false`), while the main booking route at `src/app/api/book/[slug]/route.ts:79` checks `settings.online_booking_enabled !== true` (blocks anything except explicit `true`). This means if the setting is `undefined` or `null`, the slots endpoint will leak available slots while the booking endpoint correctly blocks.

---

## IMPORTANT

### I1. CPF (sensitive PII) exposed unmasked in patient list

**File:** `src/components/patients/patient-list.tsx:190`

The patient list table renders CPF values without masking:

```tsx
{patient.cpf || '—'}
```

Meanwhile, `patient-detail-content.tsx:116` correctly uses `maskCPF(patient.cpf)` which redacts digits to `***.456.***-**`. The list view exposes full CPF to any user with patient list access (owner, practitioner, receptionist).

### I2. `deletePatientAction` allows receptionist role to delete patients

**File:** `src/actions/patients.ts:91-93`

```ts
const auth = await requireRole('owner', 'practitioner', 'receptionist')
```

Receptionists can delete patients. Delete operations on clinical data should typically be restricted to `owner` role only. The same applies to all patient mutation actions.

### I3. No auth on public booking API routes

**Files:** `src/app/api/book/[slug]/route.ts`, `src/app/api/book/[slug]/slots/route.ts`

Both public booking routes have zero authentication, which is by design for public booking. However:
- The GET route on `[slug]` exposes practitioner IDs (UUIDs) and full names
- The slots route accepts arbitrary `practitioner_id` without validation
- No CORS restrictions are configured
- These routes are susceptible to enumeration attacks (trying different slugs)

### I4. Financial entry creation not wrapped in transaction when `txDb` is undefined

**File:** `src/db/queries/financial.ts:10-69`

When `createFinancialEntry` is called without a `txDb` parameter, it wraps in `withTransaction`. However, the installment amount rounding logic (line 44-45) uses `Math.floor` + remainder redistribution. If the transaction fails after inserting the financial entry but before all installments are inserted, partial installments could be committed (depending on `withTransaction` rollback behavior).

### I5. Consent acceptances are immutable (PASS - with caveat)

No `UPDATE` or `DELETE` operations exist on `consentAcceptances` in the codebase. The `acceptConsent` function only inserts. However, there is no database-level protection (triggers or policies) to enforce immutability -- the protection is purely at the application layer.

### I6. `auth.ts` actions lack `getAuthContext()` / `requireRole()`

**File:** `src/actions/auth.ts`

The `login`, `logout`, and `resetPassword` actions don't use `getAuthContext()` or `requireRole()`. This is expected for auth-related actions (they run pre-authentication), but `switchTenantAction` should have auth checks (see C1).

---

## LOW

### L1. Stale `bg-cream` and `bg-petal` usage is intentional brand tokens

**Files:** 27 files use `bg-petal`, 2 files use `bg-cream`, 3 files use `rounded-xl`

Based on `docs/brand-tokens.md`, `bg-petal` and `bg-cream` ARE the official brand v2 tokens. The `rounded-xl` usage is limited to UI primitives (`dialog.tsx`, `command.tsx`), which is appropriate. **No action needed.**

### L2. Missing Portuguese accents in UI strings

The following unaccented Portuguese words were found in component labels:

| Word | Correct | Files |
|------|---------|-------|
| `Observacoes` | `Observa**c**oes` (needs cedilla: `Observações`) | `procedure-execution.tsx:825,830`, `procedure-form.tsx:1087,1316,1321` |
| `Descricao` | `Descrição` | `patient-financial-tab.tsx:116`, `payment-form.tsx:119`, `financial-list.tsx:127` |
| `configuracoes` | `Configurações` (URL path is fine, labels should have accents) | Used as URL path `/configuracoes` -- acceptable |

Note: URL paths like `/configuracoes`, `/pacientes`, `/financeiro` are correctly unaccented for URL safety. Only user-facing labels are affected.

### L3. TypeScript compilation errors

**4 errors found:**

1. `src/components/face-diagram/face-diagram-editor.tsx:207` -- Property `existingProducts` does not exist on type `PointFormModalProps`
2. `src/components/settings/product-list.tsx:246` -- Property `showInDiagram` does not exist on type `Product` (3 occurrences)

These indicate a schema/type mismatch where the `Product` type or `PointFormModalProps` interface is out of sync with the component usage.

### L4. SQL injection risk in patient search is mitigated

**File:** `src/db/queries/patients.ts:24-29`

The `ilike` search properly escapes `%` and `_` characters:
```ts
const escaped = search.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')
```
This uses Drizzle's parameterized `ilike()` function, so SQL injection is not possible. The escaping handles LIKE pattern characters correctly. **No action needed.**

### L5. No `dangerouslySetInnerHTML` in application code

Only found in `playwright-report/index.html` (generated test report, not app code). **No XSS risk.**

### L6. Service role key properly isolated

**File:** `src/lib/supabase/admin.ts`

The `SUPABASE_SERVICE_ROLE_KEY` is only used server-side in `admin.ts` and is never imported in client components. The admin client is only used in `src/db/queries/users.ts` for user invitations. `.env*` files are in `.gitignore`. **No exposure risk.**

### L7. Tenant isolation in queries is comprehensive (PASS)

All 15 query files in `src/db/queries/` consistently filter by `tenantId`:
- `anamnesis.ts` -- all functions receive and filter by `tenantId`
- `appointments.ts` -- all functions receive and filter by `tenantId`
- `audit.ts` -- all functions receive and filter by `tenantId`
- `consent.ts` -- all functions receive and filter by `tenantId`
- `dashboard.ts` -- all functions receive and filter by `tenantId`
- `face-diagrams.ts` -- all functions receive and filter by `tenantId`
- `financial.ts` -- all functions receive and filter by `tenantId`
- `patients.ts` -- all functions receive and filter by `tenantId`
- `photos.ts` -- all functions receive and filter by `tenantId`
- `procedures.ts` -- all functions receive and filter by `tenantId`
- `product-applications.ts` -- all functions receive and filter by `tenantId`
- `products.ts` -- all functions receive and filter by `tenantId`
- `tenants.ts` -- queries by `tenantId` directly
- `users.ts` -- queries through `tenantUsers` join with `tenantId`
- `helpers.ts` -- `verifyTenantOwnership` validates tenant ownership on foreign IDs

### L8. Auth enforcement on all server actions (PASS)

All 17 action files use either `requireRole()` or `getAuthContext()` on every exported function (except auth-related actions in `auth.ts` which is expected).

### L9. Role enforcement on sensitive operations (PASS with notes)

| Operation | Required Role | File |
|-----------|--------------|------|
| Delete patient | owner, practitioner, receptionist | `patients.ts:93` (see I2) |
| Approve procedure | owner, practitioner | `procedures.ts:315` |
| Execute procedure | owner, practitioner | `procedures.ts:420` |
| Cancel procedure | owner, practitioner | `procedures.ts:504` |
| Update settings | owner | `tenants.ts:35,44` |
| Manage users | owner | `users.ts:28,37,70,103` |
| Manage consent templates | owner | `consent.ts:48,83` |
| Financial operations | owner, receptionist, financial | `financial.ts:34,111` |
| View audit logs | owner | `audit.ts:11,16` |

### L10. Procedure lifecycle enforcement (PASS)

Both action and query levels enforce status transitions:
- `approveProcedure` query: `eq(procedureRecords.status, 'planned')` -- line 312
- `executeProcedure` query: `eq(procedureRecords.status, 'approved')` -- line 351
- `cancelProcedure` query: `inArray(procedureRecords.status, ['planned', 'approved'])` -- line 378
- Action layer double-checks status before calling query functions

**Exception:** `updateProcedure` query allows direct status override (see C2).

### L11. Financial transactions use `withTransaction` (PASS)

`createFinancialEntry` and `payInstallment` in `src/db/queries/financial.ts` both use `withTransaction` when no external transaction is provided. The `approveProcedureAction` correctly passes `tx` to `createFinancialEntry`.

---

## Summary

| Severity | Count | Key Issues |
|----------|-------|------------|
| **Critical** | 4 | Tenant switch bypass, procedure status bypass, weak rate limiting, booking settings inconsistency |
| **Important** | 6 | CPF exposure in list, receptionist delete access, public route hardening, financial transaction edge case |
| **Low** | 11 | Missing accents, TS errors, various passing checks |

### Recommended Priority

1. **Fix C1** -- Add membership validation to `switchTenantAction`
2. **Fix C2** -- Remove `status` from `updateProcedure` accepted fields or add lifecycle guards
3. **Fix C3** -- Add proper rate limiting middleware and Turnstile CAPTCHA to booking routes
4. **Fix C4** -- Align `online_booking_enabled` check to `!== true` in slots route
5. **Fix I1** -- Apply `maskCPF()` in patient list table
6. **Fix I2** -- Restrict `deletePatientAction` to `owner` role
