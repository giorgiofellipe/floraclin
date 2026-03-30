# React Query Proper Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete migration from Server Components to API routes + React Query. All data fetching through `/api/` routes. Server Actions only for mutations. No server component data fetching on interactive pages.

**Architecture:**
```
READ:  Browser → React Query hook → fetch('/api/...') GET → API Route → auth + role check → DB query → JSON
WRITE: Browser → React Query mutation → fetch('/api/...') POST/PUT/DELETE → API Route → auth + role check → DB mutation → JSON
                                    → onSuccess → invalidate queries → auto-refetch
```

**Full API approach — NO server actions for interactive pages.** Server actions are only kept for auth (login/logout) and onboarding (server-only flows).

---

## Rules

1. API routes (`/api/...`) for ALL data fetching AND mutations
2. React Query hooks use `fetch('/api/...')` for reads (useQuery) and writes (useMutation)
3. ALL interactive pages are client components — no server component data fetching
4. NO server actions called from client components (except auth login/logout)
5. Cache invalidation via React Query's `onSuccess` in mutations

**Keep as server components:**
- `(platform)/layout.tsx` — auth gate, tenant resolution
- Auth pages (login, reset-password)
- Public booking (`/c/[slug]`)
- Onboarding

---

## API Route Role Enforcement Pattern

Every API route must match the auth/role logic from its corresponding server action:

```typescript
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()

    // Copy role enforcement from the server action
    // e.g., practitioners see only their own data:
    if (ctx.role === 'practitioner') {
      // force practitionerId = ctx.userId
    }

    // Owner-only routes:
    // if (ctx.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const data = await queryFunction(ctx.tenantId, ...)
    return NextResponse.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('Forbidden')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (message.includes('redirect') || message.includes('NEXT_REDIRECT')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
```

## React Query Hook Pattern

```typescript
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'

export function usePatients(search?: string, page = 1) {
  return useQuery({
    queryKey: queryKeys.patients.list(search, page),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      params.set('page', String(page))
      const res = await fetch(`/api/patients?${params}`)
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || `HTTP ${res.status}`)
      }
      return res.json()
    },
  })
}
```

---

## Task 1: Restore All API Routes (22 routes)

**Files to create under `src/app/api/`:**

### Patients
- `GET /api/patients` — list. Role: all authenticated. Practitioners: force `responsibleUserId = ctx.userId`
- `GET /api/patients/[id]` — single patient. Role: owner + practitioner (own patients)
- `GET /api/patients/[id]/timeline` — timeline. Role: owner + practitioner

### Dashboard
- `GET /api/dashboard` — stats + appointments + follow-ups + activity. Role: all. Practitioners: force `practitionerId = ctx.userId` for scoped data. Revenue hidden from practitioners.

### Appointments
- `GET /api/appointments` — list. Role: all. Accept practitionerId, dateFrom, dateTo params.
- `GET /api/appointments/practitioners` — list practitioners for select. Role: all.
- `GET /api/appointments/procedure-types` — list procedure types for select. Role: all.

### Financial
- `GET /api/financial` — list entries. Role: owner + financial. Accept patientId, status, date filters.
- `GET /api/financial/[id]` — entry with installments. Role: owner + financial.
- `GET /api/financial/overview` — revenue summary. Role: owner + financial.
- `GET /api/financial/patients` — patient list for financial filter dropdown. Role: owner + financial.

### Procedures
- `GET /api/procedures` — list for patient. Role: owner + practitioner.
- `GET /api/procedures/[id]` — procedure with details. Role: owner + practitioner.
- `GET /api/procedures/latest` — latest non-executed for patient. Role: owner + practitioner.

### Anamnesis
- `GET /api/anamnesis/[patientId]` — get anamnesis. Role: owner + practitioner.

### Consent
- `GET /api/consent/templates` — list templates. Role: all.
- `GET /api/consent/history/[patientId]` — consent history. Role: owner + practitioner.

### Products
- `GET /api/products` — list products. Accept `filter` param (active/diagram/all). Role: all for active/diagram, owner for all.

### Procedure Types
- `GET /api/procedure-types` — list types. Role: all.

### Evaluation
- `GET /api/evaluation/templates` — templates by typeIds. Role: all.
- `GET /api/evaluation/responses/[procedureId]` — responses. Role: owner + practitioner.

### Tenant / Settings
- `GET /api/tenant` — current tenant. Role: all.
- `GET /api/tenant/users` — tenant users. Role: owner.

### Audit
- `GET /api/audit` — audit logs. Role: owner only.

### Mutation API Routes (POST/PUT/DELETE)

#### Patients
- `POST /api/patients` — create patient
- `PUT /api/patients/[id]` — update patient
- `DELETE /api/patients/[id]` — soft delete patient

#### Appointments
- `POST /api/appointments` — create appointment
- `PUT /api/appointments/[id]` — update appointment
- `PUT /api/appointments/[id]/status` — update status
- `DELETE /api/appointments/[id]` — soft delete

#### Financial
- `POST /api/financial` — create financial entry with installments
- `PUT /api/financial/installments/[id]/pay` — mark installment paid

#### Procedures
- `POST /api/procedures` — create procedure
- `PUT /api/procedures/[id]` — update procedure
- `POST /api/procedures/[id]/approve` — approve procedure
- `POST /api/procedures/[id]/execute` — execute procedure
- `POST /api/procedures/[id]/cancel` — cancel procedure

#### Anamnesis
- `PUT /api/anamnesis/[patientId]` — upsert anamnesis

#### Consent
- `POST /api/consent/templates` — create template
- `PUT /api/consent/templates/[id]` — update template (new version)
- `POST /api/consent/accept` — accept consent

#### Products
- `POST /api/products` — create product
- `PUT /api/products/[id]` — update product
- `DELETE /api/products/[id]` — delete product
- `PUT /api/products/[id]/toggle-active` — toggle active
- `PUT /api/products/[id]/toggle-diagram` — toggle diagram visibility

#### Procedure Types
- `POST /api/procedure-types` — create
- `PUT /api/procedure-types/[id]` — update
- `DELETE /api/procedure-types/[id]` — delete

#### Users
- `POST /api/tenant/users/invite` — invite user
- `PUT /api/tenant/users/[id]/role` — update role
- `PUT /api/tenant/users/[id]/deactivate` — deactivate

#### Tenant
- `PUT /api/tenant` — update tenant settings

#### Face Diagrams
- `POST /api/face-diagrams` — save diagram
- `POST /api/product-applications` — save product applications

#### Evaluation
- `POST /api/evaluation/templates` — create/update template
- `POST /api/evaluation/responses` — save response

**Commit:** `feat: restore all API routes with proper role enforcement (reads + mutations)`

---

## Task 2: Rewrite All Query Hooks to fetch('/api/...')

**Files to modify in `src/hooks/queries/`:**

Every hook currently calls a server action as `queryFn`. Rewrite each to use `fetch('/api/...')`.

- `use-patients.ts` — fetch from `/api/patients`, `/api/patients/[id]`, `/api/patients/[id]/timeline`
- `use-dashboard.ts` — fetch from `/api/dashboard`
- `use-appointments.ts` — fetch from `/api/appointments`, `/api/appointments/practitioners`, `/api/appointments/procedure-types`
- `use-financial.ts` — fetch from `/api/financial`, `/api/financial/overview`, `/api/financial/patients`
- `use-procedures.ts` — fetch from `/api/procedures`, `/api/procedures/[id]`, `/api/procedures/latest`
- `use-anamnesis.ts` — fetch from `/api/anamnesis/[patientId]`
- `use-consent.ts` — fetch from `/api/consent/templates`, `/api/consent/history/[patientId]`
- `use-products.ts` — fetch from `/api/products?filter=diagram`, `/api/products?filter=active`, `/api/products?filter=all`
- `use-procedure-types.ts` — fetch from `/api/procedure-types`
- `use-evaluation.ts` — fetch from `/api/evaluation/templates`, `/api/evaluation/responses/[id]`
- `use-tenant.ts` — fetch from `/api/tenant`, `/api/tenant/users`
- `use-audit.ts` — fetch from `/api/audit`

**Delete `use-settings.ts`** — it duplicates hooks from standalone files.

Remove ALL server action imports from hook files.

### Mutation Hooks

Create `src/hooks/mutations/` directory with mutation hooks using `useMutation`:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../queries/query-keys'

export function useCreatePatient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: CreatePatientInput) => {
      const res = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.patients.all })
    },
  })
}
```

Create mutation hooks for all entities:
- `use-patient-mutations.ts` — create, update, delete
- `use-appointment-mutations.ts` — create, update, updateStatus, delete
- `use-financial-mutations.ts` — create entry, pay installment
- `use-procedure-mutations.ts` — create, update, approve, execute, cancel
- `use-anamnesis-mutations.ts` — upsert
- `use-consent-mutations.ts` — create/update template, accept consent
- `use-product-mutations.ts` — CRUD, toggle active/diagram
- `use-procedure-type-mutations.ts` — CRUD
- `use-user-mutations.ts` — invite, update role, deactivate
- `use-tenant-mutations.ts` — update tenant
- `use-diagram-mutations.ts` — save diagram, save product applications
- `use-evaluation-mutations.ts` — save template, save response

### Update Components to Use Mutation Hooks

All components that currently call server actions directly need to be updated to use the mutation hooks instead. Pattern:

```typescript
// Before:
const result = await createPatientAction(data)
if (result.success) { invalidatePatients(); toast.success('...') }

// After:
const { mutateAsync: createPatient } = useCreatePatient()
await createPatient(data) // onSuccess handles invalidation automatically
toast.success('...')
```

**Commit:** `feat: rewrite all query hooks to fetch(/api/), create mutation hooks`

---

## Task 3: Migrate Remaining Server Component Pages

**Pages to migrate:**

### `/pacientes/[id]/procedimentos/[procedureId]/page.tsx`
- Currently: async server component loading procedure, diagrams, applications, patient
- Convert to: thin server shell + client component using `useProcedure(id)`, `usePatient(patientId)`
- Keep `generateMetadata` in server component if needed

### `/configuracoes/avaliacao/[procedureTypeId]/page.tsx`
- Currently: async server component loading procedure type and template
- Convert to: client component using `useProcedureTypes()` + `useEvaluationTemplate(typeId)`
- Add API route for single evaluation template if needed

### `/pacientes/[id]/atendimento/page.tsx`
- Currently: async server component loading patient, anamnesis, procedure, diagrams
- Convert to: client component using existing hooks
- Keep `generateMetadata` in server shell

### `/configuracoes/page.tsx`
- Currently: still has `requireRole('owner')` server-side
- Convert to: move role check to client (redirect if not owner) or keep thin server shell for auth gate only

### `/pacientes/[id]/page.tsx`
- Currently: partially migrated but still has `generateMetadata` with server fetch
- Verify it's fully client-side for data

**Commit:** `feat: migrate all remaining pages to client components with React Query`

---

## Task 4: Fix CalendarView

**File:** `src/components/scheduling/calendar-view.tsx`

- Remove local `appointments` state and `fetchAppointments` function
- Accept appointments data from `useAppointments()` via props or use the hook directly
- After mutations (create/edit/delete appointment), call `invalidateAppointments()` — React Query refetches automatically
- Remove `onSaved` callback pattern — replace with invalidation

**Commit:** `feat: CalendarView uses React Query only — remove dual data source`

---

## Task 5: Cleanup

- Remove ALL server action imports from client components (except auth login/logout and onboarding)
- Delete server action files that are no longer used (read actions AND mutation actions that have been replaced by API routes)
- Keep ONLY: `src/actions/auth.ts` (login/logout), `src/actions/onboarding.ts` (server-side only flow)
- Remove `use-settings.ts` if not already removed
- Verify NO `'use server'` functions are called from client components
- Remove `useInvalidation` hook (invalidation now handled by `onSuccess` in mutation hooks)

**Commit:** `chore: remove all server actions replaced by API routes, cleanup dead code`

---

## Dependency Graph

```
Task 1: API Routes (must be first — hooks depend on them)
  ↓
Task 2: Rewrite hooks to fetch('/api/...')
  ↓
Tasks 3, 4, 5 IN PARALLEL:
  Task 3: Migrate remaining pages
  Task 4: Fix CalendarView
  Task 5: Cleanup
```

---

## Post-Implementation Checklist

- [ ] Every API route has auth check + role enforcement matching its server action
- [ ] Every query hook uses `fetch('/api/...')` — no server action calls
- [ ] No server component pages fetch data (except auth pages, booking, onboarding, layout)
- [ ] CalendarView uses React Query only — no local fetchAppointments
- [ ] All mutations still use Server Actions (unchanged)
- [ ] All mutation sites call `useInvalidation()` after success
- [ ] TypeScript compiles with 0 errors
- [ ] Dashboard: practitioners see only their own data
- [ ] Patients: practitioners see only their own patients
- [ ] Audit: only owners can access
- [ ] Financial: only owner + financial roles can access
