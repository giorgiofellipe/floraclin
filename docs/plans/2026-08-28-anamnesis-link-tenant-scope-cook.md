# Anamnesis Tenant Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it impossible for a caller in tenant A to write an `anamnesis_tokens` or `anamneses` row against tenant B's patient, and make any such row already in the database unresolvable.

**Architecture:** Guard the two writers that accept a patient id as a parameter, `createAnamnesisToken` and `upsertAnamnesis`, with `verifyTenantOwnership`, the helper this repo already uses for exactly this in `photos.ts`, `consent.ts`, `procedures.ts`, `financial.ts`, and `appointments.ts`. The writer guard is the invariant. On top of it, the `anamnesis-link` route keeps a `getPatient` preflight so the common case answers 404 instead of 500, and `getValidToken` gains a tenant-matched join so tokens already issued before this change stop resolving.

**Tech Stack:** Next.js App Router route handlers, Drizzle ORM, Vitest.

**Spec:** This document. Revised after adversarial review (Codex Skeptic + Architect, both REJECT on the first draft); the corrections are folded into the Background below.

## Background: the defect

`web/src/app/api/patients/[id]/anamnesis-link/route.ts:17` passes the raw `[id]` path param
straight into `createAnamnesisToken(ctx.tenantId, patientId, ctx.userId)`. The only check on
`patientId` is the `anamnesis_tokens.patient_id` foreign key, which proves the patient exists
somewhere in the database, not that it belongs to the caller's tenant. `createAnamnesisToken`
(`web/src/db/queries/anamnesis-tokens.ts:5-14`) inserts whatever `(tenantId, patientId)` pair
it is handed.

An authenticated user in tenant A who knows a patient UUID from tenant B can therefore create
a token row reading `(tenantId: A, patientId: B-patient)`. From there:

1. `GET /api/anamnesis/token/[token]` returns `row.patientName.split(' ')[0]`. `getValidToken`
   joins `patients` on id alone, so the victim patient's first name leaks across the boundary.
2. `PUT /api/anamnesis/token/[token]` calls `upsertAnamnesis(row.tenantId, row.patientId, ...)`.

`upsertAnamnesis` (`web/src/db/queries/anamnesis.ts:28-98`) has no tenant guard either, and
**`anamneses.patient_id` is globally unique** (`web/src/db/schema.ts:88`,
`.references(() => patients.id).unique()`). That makes step 2 worse than a stray row:

- Victim patient has no anamnesis yet → the cross-tenant insert **succeeds**, and the unique
  constraint now permanently blocks tenant B from ever creating its own patient's anamnesis.
- Victim patient already has one → `getAnamnesis(A, B-patient)` misses (it is tenant-scoped),
  the code falls through to insert, and the unique constraint rejects it with a 500.

The same write is reachable without any token at all: `PUT /api/anamnesis/[patientId]`
(`web/src/app/api/anamnesis/[patientId]/route.ts:36-57`) takes the patient id from the path
and calls `upsertAnamnesis` with no ownership check. Guarding only the token path would leave
this open, which is why the guard belongs in the writers.

### On precedent

An earlier draft of this plan claimed every sibling route under `api/patients/[id]/` performs
a `getPatient` check. That is false. `documents/route.ts:15`, `evolutions/*`, `[id]/route.ts:19`
and `anamnesis-link/send/route.ts:38` do; `packages/route.ts:14` and `timeline/route.ts:63`
instead delegate to queries that are tenant-scoped internally, and return an empty result
rather than a 404. Both are valid, what matters is that the tenant boundary is enforced
somewhere on every path. For writers that take a foreign id as a parameter, this repo's
answer is `verifyTenantOwnership` at the query layer. The anamnesis writers are the ones that
skipped it.

## Global Constraints

- Never use `git push --no-verify`. `pnpm ci:checks` (lint + typecheck + `vitest run`) must pass.
- Error copy is Portuguese. The route 404 must read exactly `'Paciente não encontrado'`,
  matching `anamnesis-link/send/route.ts:40`.
- `verifyTenantOwnership(tenantId, table, id, label)` lives in `web/src/db/queries/helpers.ts:9`.
  It throws a plain `Error`, which `handleApiError` turns into a 500 plus a Sentry event. That
  is the established behavior for a cross-tenant id in this repo (`face-diagrams/route.ts:51`,
  `product-applications/route.ts:44`). Do not invent a new error type.
- Do not add a database migration. A composite `(patient_id, tenant_id)` foreign key is the
  right long-term enforcement but needs a data-cleanup step; it is a tracked follow-up.
- `Role` is `'owner' | 'practitioner' | 'receptionist' | 'financial'` (`web/src/types/index.ts:1`).
- Vitest in this repo never connects to Postgres. All tests here are pure-unit with mocks.
- **Do not break the second caller.** `createAnamnesisToken` is also called from
  `web/src/app/api/webhooks/whatsapp/route.ts:751`, which already calls
  `getPatient(tenantId, patientId)` at `:733` and returns early on null. The new guard is a
  no-op there. Verify this still holds; do not modify that file.
- Implementers must not run `git commit`. All tasks share one worktree and a concurrent commit
  races the index. The orchestrator commits after the group completes.

## Out of scope (deliberately deferred, reported to the user)

- **Token consumption is not transactional.** `api/anamnesis/token/[token]/route.ts:62-69`
  writes the anamnesis, then calls `markTokenUsed` and ignores its return value. Two concurrent
  PUTs can both pass `getValidToken`. `api/consent/sign/route.ts:41-45` shows the repo's
  transactional pattern. Pre-existing, unrelated to tenant scope.
- **The send route does not bind the token to the patient.**
  `anamnesis-link/send/route.ts:67` extracts whatever token appears in the posted URL after
  prefix-checking it. Patient X in the path with patient Y's token in the body sends Y's link
  to X's phone.
- **No route-level 404 on `PUT /api/anamnesis/[patientId]`.** After this change a cross-tenant
  id there returns 500 + Sentry, matching `face-diagrams`. The write is blocked, which is the
  security requirement; the status code is cosmetic.

## Added after review

`getValidToken` also filters `isNull(patients.deletedAt)`. `verifyTenantOwnership` rejects a
soft-deleted patient at save time, so without this the patient would fill the whole form and
get a 500 on submit. Dropping them at the join means the link shows the ordinary
"link expirado" page instead, and does not confirm the record exists.

---

## Group A (parallel, file sets are disjoint)

### Task 1: Guard the token writer and the token resolver

**Files:**
- Modify: `web/src/db/queries/anamnesis-tokens.ts`
- Create: `web/src/db/queries/__tests__/anamnesis-tokens-tenant-scope.test.ts`

**Interfaces:**
- Consumes: `verifyTenantOwnership(tenantId: string, table: {id, tenantId, deletedAt?}, id: string, label?: string): Promise<void>`
  from `./helpers`, throws `Error('Patient not found or does not belong to this tenant')` on mismatch.
- Produces: `createAnamnesisToken` and `getValidToken` keep their existing signatures and
  return shapes. `createAnamnesisToken` now rejects instead of resolving when the patient is
  foreign. Callers in `api/patients/[id]/anamnesis-link/route.ts`,
  `api/webhooks/whatsapp/route.ts` and `api/anamnesis/token/[token]/route.ts` are unchanged.

- [x] **Step 1: Write the failing test**

Create `web/src/db/queries/__tests__/anamnesis-tokens-tenant-scope.test.ts`.

```ts
/**
 * `anamnesis_tokens` has independent foreign keys to `patients` and `tenants`
 * (web/src/db/schema.ts:115-116), so nothing in the database stops a row from
 * pairing one tenant with another tenant's patient. Two guards, tested here:
 *
 *   - `createAnamnesisToken` refuses to write the pair in the first place.
 *     This is the invariant, it holds for every caller, present and future.
 *   - `getValidToken` refuses to resolve a pair already written before the
 *     guard existed. This one is asserted on query shape rather than behavior:
 *     vitest here never reaches Postgres, and the row it defends against
 *     cannot be created any more.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { recorded } = vi.hoisted(() => ({
  recorded: { joinOn: [] as unknown[], inserted: [] as unknown[] },
}))

vi.mock('@/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: (_table: unknown, on: unknown) => {
          recorded.joinOn.push(on)
          return { where: () => ({ limit: () => Promise.resolve([]) }) }
        },
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        recorded.inserted.push(v)
        return { returning: () => Promise.resolve([{ token: 'tok', expiresAt: new Date() }]) }
      },
    }),
  },
}))

vi.mock('@/db/schema', () => ({
  anamnesisTokens: {
    id: 'anamnesis_tokens.id',
    token: 'anamnesis_tokens.token',
    patientId: 'anamnesis_tokens.patient_id',
    tenantId: 'anamnesis_tokens.tenant_id',
    createdBy: 'anamnesis_tokens.created_by',
    expiresAt: 'anamnesis_tokens.expires_at',
    usedAt: 'anamnesis_tokens.used_at',
  },
  patients: {
    id: 'patients.id',
    tenantId: 'patients.tenant_id',
    fullName: 'patients.full_name',
    deletedAt: 'patients.deleted_at',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }),
  and: (...parts: unknown[]) => ({ op: 'and', parts }),
  isNull: (a: unknown) => ({ op: 'isNull', a }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: 'sql',
    strings: [...strings],
    values,
  }),
}))

vi.mock('@/db/queries/helpers', () => ({
  verifyTenantOwnership: vi.fn(),
}))

import { verifyTenantOwnership } from '@/db/queries/helpers'
import { patients } from '@/db/schema'
import { createAnamnesisToken, getValidToken } from '@/db/queries/anamnesis-tokens'

/** Flattens nested `and(...)` nodes into their leaf predicates. */
function leaves(node: unknown): Array<Record<string, unknown>> {
  if (!node || typeof node !== 'object') return []
  const n = node as Record<string, unknown>
  if (n.op === 'and') return (n.parts as unknown[]).flatMap(leaves)
  return [n]
}

beforeEach(() => {
  recorded.joinOn.length = 0
  recorded.inserted.length = 0
  vi.mocked(verifyTenantOwnership).mockReset()
  vi.mocked(verifyTenantOwnership).mockResolvedValue(undefined)
})

describe('createAnamnesisToken', () => {
  it('checks the patient belongs to the tenant before inserting', async () => {
    await createAnamnesisToken('tenant-1', 'patient-1', 'user-1')

    expect(verifyTenantOwnership).toHaveBeenCalledWith(
      'tenant-1',
      patients,
      'patient-1',
      'Patient',
    )
    expect(recorded.inserted).toHaveLength(1)
  })

  it('writes nothing when the patient belongs to another tenant', async () => {
    vi.mocked(verifyTenantOwnership).mockRejectedValueOnce(
      new Error('Patient not found or does not belong to this tenant'),
    )

    await expect(
      createAnamnesisToken('tenant-1', 'victim-patient', 'user-1'),
    ).rejects.toThrow('does not belong to this tenant')

    // The whole point: no row pairing tenant A with tenant B's patient.
    expect(recorded.inserted).toHaveLength(0)
  })
})

describe('getValidToken', () => {
  it('joins the patient on id AND tenant, so a legacy cross-tenant token resolves to nothing', async () => {
    await getValidToken('some-token')

    expect(recorded.joinOn).toHaveLength(1)
    const predicates = leaves(recorded.joinOn[0])

    expect(predicates).toContainEqual({
      op: 'eq',
      a: 'patients.id',
      b: 'anamnesis_tokens.patient_id',
    })
    expect(predicates).toContainEqual({
      op: 'eq',
      a: 'patients.tenant_id',
      b: 'anamnesis_tokens.tenant_id',
    })
    expect(predicates).toContainEqual({ op: 'isNull', a: 'patients.deleted_at' })
  })
})
```

- [x] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @floraclin/web test:run -- anamnesis-tokens-tenant-scope`

Expected: all three tests fail. `verifyTenantOwnership` is never called, the rejected-guard
test still inserts, and the join carries only the `patients.id` predicate.

- [x] **Step 3: Add both guards**

Rewrite `web/src/db/queries/anamnesis-tokens.ts` as follows. Note the two import changes
(`patients` gains a use beyond the join; `verifyTenantOwnership` is new) and that
`markTokenUsed` is untouched, it only runs on a token `getValidToken` already validated.

```ts
import { db } from '@/db/client'
import { anamnesisTokens, patients } from '@/db/schema'
import { eq, and, isNull, sql } from 'drizzle-orm'
import { verifyTenantOwnership } from './helpers'

export async function createAnamnesisToken(tenantId: string, patientId: string, createdBy: string) {
  await verifyTenantOwnership(tenantId, patients, patientId, 'Patient')

  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours

  const [token] = await db
    .insert(anamnesisTokens)
    .values({ patientId, tenantId, expiresAt, createdBy })
    .returning()

  return token
}

export async function getValidToken(token: string) {
  const [row] = await db
    .select({
      id: anamnesisTokens.id,
      token: anamnesisTokens.token,
      patientId: anamnesisTokens.patientId,
      tenantId: anamnesisTokens.tenantId,
      createdBy: anamnesisTokens.createdBy,
      expiresAt: anamnesisTokens.expiresAt,
      usedAt: anamnesisTokens.usedAt,
      patientName: patients.fullName,
    })
    .from(anamnesisTokens)
    .innerJoin(
      patients,
      and(
        eq(patients.id, anamnesisTokens.patientId),
        eq(patients.tenantId, anamnesisTokens.tenantId),
        isNull(patients.deletedAt)
      )
    )
    .where(
      and(
        eq(anamnesisTokens.token, token),
        isNull(anamnesisTokens.usedAt),
        sql`${anamnesisTokens.expiresAt} > now()`
      )
    )
    .limit(1)

  return row ?? null
}

export async function markTokenUsed(token: string) {
  const [row] = await db
    .update(anamnesisTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(anamnesisTokens.token, token),
        isNull(anamnesisTokens.usedAt),
        sql`${anamnesisTokens.expiresAt} > now()`
      )
    )
    .returning()

  return row ?? null
}
```

- [x] **Step 4: Run the test and verify it passes**

Run: `pnpm --filter @floraclin/web test:run -- anamnesis-tokens-tenant-scope`

Expected: 3 tests pass.

- [x] **Step 5: Report completion**

Do NOT commit. Report the files you changed and the test output to the orchestrator.

---

### Task 2: Guard the anamnesis writer

**Files:**
- Modify: `web/src/db/queries/anamnesis.ts`
- Create: `web/src/db/queries/__tests__/anamnesis-tenant-scope.test.ts`

**Interfaces:**
- Consumes: `verifyTenantOwnership` from `./helpers` (same signature as Task 1).
- Produces: `upsertAnamnesis(tenantId, patientId, userId, data, expectedUpdatedAt?)` keeps its
  signature and return shape, and now rejects when the patient is foreign. `getAnamnesis` and
  `StaleDataError` are unchanged. Callers in `api/anamnesis/[patientId]/route.ts` and
  `api/anamnesis/token/[token]/route.ts` are unchanged.

- [x] **Step 1: Write the failing test**

Create `web/src/db/queries/__tests__/anamnesis-tenant-scope.test.ts`.

```ts
/**
 * `anamneses.patient_id` is globally unique (web/src/db/schema.ts:88), so a
 * row written as (tenant A, tenant B's patient) is not just stray data, it
 * permanently occupies the only slot tenant B's patient will ever have, and
 * tenant B's own save then fails on the constraint.
 *
 * `upsertAnamnesis` is reachable from two routes: the token flow and
 * `PUT /api/anamnesis/[patientId]`, which takes the patient id straight from
 * the path. Guarding it here covers both.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { recorded, results } = vi.hoisted(() => ({
  recorded: { inserted: [] as unknown[], updated: [] as unknown[] },
  results: { existing: [] as unknown[] },
}))

vi.mock('@/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(results.existing) }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        recorded.inserted.push(v)
        return { returning: () => Promise.resolve([{ id: 'a1', updatedAt: new Date() }]) }
      },
    }),
    update: () => ({
      set: (v: unknown) => {
        recorded.updated.push(v)
        return {
          where: () => ({
            returning: () => Promise.resolve([{ id: 'a1', updatedAt: new Date() }]),
          }),
        }
      },
    }),
  },
}))

vi.mock('@/db/schema', () => ({
  anamneses: { tenantId: 'anamneses.tenant_id', patientId: 'anamneses.patient_id' },
  patients: {
    id: 'patients.id',
    tenantId: 'patients.tenant_id',
    deletedAt: 'patients.deleted_at',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }),
  and: (...parts: unknown[]) => ({ op: 'and', parts }),
}))

vi.mock('@/db/queries/helpers', () => ({
  verifyTenantOwnership: vi.fn(),
}))

import { verifyTenantOwnership } from '@/db/queries/helpers'
import { patients } from '@/db/schema'
import { upsertAnamnesis } from '@/db/queries/anamnesis'
import { anamnesisSchema, type AnamnesisFormData } from '@/validations/anamnesis'

const DATA: AnamnesisFormData = anamnesisSchema.parse({})

const FOREIGN_PATIENT = new Error('Patient not found or does not belong to this tenant')

beforeEach(() => {
  recorded.inserted.length = 0
  recorded.updated.length = 0
  results.existing = []
  vi.mocked(verifyTenantOwnership).mockReset()
  vi.mocked(verifyTenantOwnership).mockResolvedValue(undefined)
})

describe('upsertAnamnesis', () => {
  it('checks the patient belongs to the tenant before writing', async () => {
    await upsertAnamnesis('tenant-1', 'patient-1', 'user-1', DATA)

    expect(verifyTenantOwnership).toHaveBeenCalledWith(
      'tenant-1',
      patients,
      'patient-1',
      'Patient',
    )
    expect(recorded.inserted).toHaveLength(1)
  })

  it('inserts nothing when the patient belongs to another tenant', async () => {
    vi.mocked(verifyTenantOwnership).mockRejectedValueOnce(FOREIGN_PATIENT)

    await expect(
      upsertAnamnesis('tenant-1', 'victim-patient', 'user-1', DATA),
    ).rejects.toThrow('does not belong to this tenant')

    expect(recorded.inserted).toHaveLength(0)
  })

  it('updates nothing when the patient belongs to another tenant', async () => {
    // A row for this patient already exists, so an unguarded call would take
    // the update branch and never reach the insert the previous case covers.
    results.existing = [{ id: 'a1', updatedAt: new Date() }]
    vi.mocked(verifyTenantOwnership).mockRejectedValueOnce(FOREIGN_PATIENT)

    await expect(
      upsertAnamnesis('tenant-1', 'victim-patient', 'user-1', DATA),
    ).rejects.toThrow('does not belong to this tenant')

    expect(recorded.updated).toHaveLength(0)
  })
})
```

- [x] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @floraclin/web test:run -- anamnesis-tenant-scope`

Expected: all three tests fail. `verifyTenantOwnership` is never called, and both the insert
and update paths run despite the rejected guard.

- [x] **Step 3: Add the guard**

In `web/src/db/queries/anamnesis.ts`, extend the imports and add the guard as the first
statement of `upsertAnamnesis`, before the `getAnamnesis` read. Leave `getAnamnesis` and
`StaleDataError` alone.

```ts
import { db } from '@/db/client'
import { anamneses, patients } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { verifyTenantOwnership } from './helpers'
import type { AnamnesisFormData } from '@/validations/anamnesis'
```

```ts
export async function upsertAnamnesis(
  tenantId: string,
  patientId: string,
  userId: string,
  data: AnamnesisFormData,
  expectedUpdatedAt?: Date
) {
  await verifyTenantOwnership(tenantId, patients, patientId, 'Patient')

  const existing = await getAnamnesis(tenantId, patientId)
  // ... rest of the function unchanged
```

- [x] **Step 4: Run the test and verify it passes**

Run: `pnpm --filter @floraclin/web test:run -- anamnesis-tenant-scope`

Expected: 3 tests pass.

- [x] **Step 5: Report completion**

Do NOT commit. Report the files you changed and the test output to the orchestrator.

---

### Task 3: Answer 404, not 500, on the anamnesis-link route

**Files:**
- Modify: `web/src/app/api/patients/[id]/anamnesis-link/route.ts`
- Modify: `web/src/lib/app-url.ts` (doc comment only; it named this route as a
  hand-rolled-pattern user, which the `getAppUrl()` swap made false)
- Create: `web/src/app/api/patients/[id]/anamnesis-link/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `getPatient(tenantId: string, patientId: string): Promise<Patient | null>` from
  `@/db/queries/patients`, and `createAnamnesisToken(tenantId, patientId, createdBy)` from
  `@/db/queries/anamnesis-tokens`. This task mocks both, so it does not depend on Task 1.
- Produces: nothing consumed by another task.

Task 1's writer guard already blocks the cross-tenant write; unguarded, the route would
surface it as a 500 plus a Sentry event. This preflight makes the ordinary case a clean 404,
matching the sibling `anamnesis-link/send/route.ts:38-41`.

- [x] **Step 1: Write the failing test**

Create `web/src/app/api/patients/[id]/anamnesis-link/__tests__/route.test.ts`. This mirrors
the route-test pattern in `web/src/app/api/patients/[id]/evolutions/__tests__/routes.test.ts`.

```ts
/**
 * The route mints a link token from the `[id]` path param. The writer guard in
 * `createAnamnesisToken` is what makes a cross-tenant token impossible; this
 * preflight is what makes the answer a 404 instead of a 500 plus a Sentry
 * event, matching the sibling send route.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
}))

vi.mock('@/db/queries/patients', () => ({
  getPatient: vi.fn(),
}))

vi.mock('@/db/queries/anamnesis-tokens', () => ({
  createAnamnesisToken: vi.fn(),
}))

import { getAuthContext } from '@/lib/auth'
import { getPatient } from '@/db/queries/patients'
import { createAnamnesisToken } from '@/db/queries/anamnesis-tokens'
import { POST } from '../route'

const AUTH_OK = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  role: 'receptionist' as const,
  email: 'reception@example.com',
  fullName: 'Reception Example',
  isPlatformAdmin: false,
}

const EXPIRES_AT = new Date('2026-08-28T15:00:00.000Z')

function postRequest(patientId: string): Request {
  return new Request(`http://localhost/api/patients/${patientId}/anamnesis-link`, {
    method: 'POST',
  })
}

function paramsOf(id: string): Promise<{ id: string }> {
  return Promise.resolve({ id })
}

beforeEach(() => {
  vi.mocked(getAuthContext).mockReset()
  vi.mocked(getPatient).mockReset()
  vi.mocked(createAnamnesisToken).mockReset()

  vi.mocked(getAuthContext).mockResolvedValue(AUTH_OK as never)
  // Tenant-scoped `getPatient` returns null for any id outside the tenant;
  // the cross-tenant test overrides the default with exactly that.
  vi.mocked(getPatient).mockResolvedValue({ id: 'patient-1' } as never)
  vi.mocked(createAnamnesisToken).mockResolvedValue({
    token: 'token-uuid',
    expiresAt: EXPIRES_AT,
  } as never)
})

describe('POST /api/patients/[id]/anamnesis-link', () => {
  it('returns 404 and mints nothing when the patient is in another tenant', async () => {
    vi.mocked(getPatient).mockResolvedValueOnce(null)

    const res = await POST(postRequest('victim-patient'), {
      params: paramsOf('victim-patient'),
    })

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'Paciente não encontrado' })
    expect(createAnamnesisToken).not.toHaveBeenCalled()
  })

  it('scopes the patient lookup to the caller tenant', async () => {
    await POST(postRequest('patient-1'), { params: paramsOf('patient-1') })

    expect(getPatient).toHaveBeenCalledWith('tenant-1', 'patient-1')
  })

  it('returns the link for a patient in the caller tenant', async () => {
    const res = await POST(postRequest('patient-1'), { params: paramsOf('patient-1') })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.url).toMatch(/\/a\/token-uuid$/)
    expect(json.expiresAt).toBe(EXPIRES_AT.toISOString())
    expect(createAnamnesisToken).toHaveBeenCalledWith('tenant-1', 'patient-1', 'user-1')
  })

  it('returns 403 for a role that may not issue links', async () => {
    vi.mocked(getAuthContext).mockResolvedValueOnce({
      ...AUTH_OK,
      role: 'financial',
    } as never)

    const res = await POST(postRequest('patient-1'), { params: paramsOf('patient-1') })

    expect(res.status).toBe(403)
    expect(getPatient).not.toHaveBeenCalled()
    expect(createAnamnesisToken).not.toHaveBeenCalled()
  })
})
```

- [x] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @floraclin/web test:run -- anamnesis-link`

Expected: the 404 test and the lookup-scoping test fail. `getPatient` is never called, so the
route mints a token and returns 200.

- [x] **Step 3: Add the preflight**

Rewrite `web/src/app/api/patients/[id]/anamnesis-link/route.ts`. The guard goes after
`await params` and before `createAnamnesisToken`. The hand-rolled base-URL fallback is
replaced by `getAppUrl()`, the existing helper that reproduces the same
fallback chain and was never wired back into this route.

```ts
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getPatient } from '@/db/queries/patients'
import { createAnamnesisToken } from '@/db/queries/anamnesis-tokens'
import { getAppUrl } from '@/lib/app-url'
import { handleApiError } from '@/lib/api-error'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner', 'receptionist'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: patientId } = await params
    const patient = await getPatient(ctx.tenantId, patientId)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    const token = await createAnamnesisToken(ctx.tenantId, patientId, ctx.userId)
    const url = `${getAppUrl()}/a/${token.token}`

    return NextResponse.json({ url, expiresAt: token.expiresAt })
  } catch (error) {
    return handleApiError(error, request)
  }
}
```

- [x] **Step 4: Run the test and verify it passes**

Run: `pnpm --filter @floraclin/web test:run -- anamnesis-link`

Expected: 4 tests pass.

- [x] **Step 5: Report completion**

Do NOT commit. Report the files you changed and the test output to the orchestrator.

---

## Group B (depends on A), orchestrator only

- [x] Confirm the three agents touched only their seven owned files.
- [x] Confirm `web/src/app/api/webhooks/whatsapp/route.ts` is unmodified and still calls
      `getPatient` before `createAnamnesisToken`.
- [x] Run the full suite: `pnpm --filter @floraclin/web test:run`.
- [x] Run `pnpm ci:checks`.
- [x] Commit all three tasks as one change.
