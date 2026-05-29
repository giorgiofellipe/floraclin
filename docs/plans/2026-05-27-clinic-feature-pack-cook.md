# Clinic feature pack — implementation plan (cook)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Cook execution:** tasks are organized into parallelization Groups — within a group, tasks have disjoint file ownership and run in parallel agents simultaneously.

**Goal:** Ship the six client-requested features from `docs/superpowers/specs/2026-05-27-clinic-feature-pack-design.md` — birthday reminder, photo cropping, procedure packages, professional signature, prescriptions/atestados, and open planejamentos follow-up.

**Architecture:** Single Drizzle migration AND all new npm dependencies land up front (Group 0). Topic backends, the shared `ClinicHeader`, and the `getSignatureBlock` foundation land in parallel (Group 1). Topic UIs and the documents stack (consolidated into one big task to avoid file conflicts) land in parallel (Group 2). Cross-cutting wiring (dashboard widgets, patient-detail tabs, configurações menu, WhatsApp template kinds, procedure-page followup section) lands serially at the end (Group 3).

**Security:** Print pages for clinical documents and procedure records are session-authenticated, under `/(platform)/...` — NOT public `/c/` URLs. PHI must never be reachable via UUID alone.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Drizzle ORM, PostgreSQL (`floraclin` schema), React Query, Tailwind, shadcn/ui, Vitest, `react-image-crop` (new), `@sparticuz/chromium-min` + `puppeteer-core` (new).

---

## Conventions referenced by every task

- All date/time handling uses `@/lib/dates` helpers per `AGENTS.md`. Never bare `new Date('YYYY-MM-DD')` or `.toISOString().split('T')[0]`.
- All new server routes go under `web/src/app/api/...`, use the project's existing auth/tenant middleware, and return `NextResponse.json(...)`. Permission rule: every query and mutation filters by `tenantId`; reject when the resource's `tenantId` doesn't match the caller's.
- All new tables get an index on `tenantId` (already standard in this codebase).
- All schema additions live in `web/src/db/schema.ts`. Migrations are produced by `pnpm --filter @floraclin/web exec drizzle-kit generate` and committed alongside the schema diff.
- Default test runner: Vitest. Test files live next to source under `__tests__/` (existing convention — see `web/src/lib/__tests__/` and `web/src/components/consent/__tests__/`).
- Commits never reference Claude. Use Conventional Commits matching the repo's history (`feat(scope): …`, `fix(scope): …`).

---

# Group 0 — Schema, migration, and new dependencies (sequential, 1 task)

This whole group is one task because every later task reads `schema.ts`, the generated migration file, and the workspace's `package.json` / lockfile. Splitting would force merge conflicts.

**Pre-existing migration metadata drift to know about:** `web/src/db/migrations/meta/_journal.json` currently tracks through migration index 10 (`0010_whatsapp_queued_messages`), but the filesystem also contains `0011_prospect_allow_multiple_per_phone.sql` with no matching snapshot or journal entry. Drizzle may treat this inconsistently. Do NOT try to "fix" `_journal.json` by hand — let `drizzle-kit generate` produce whatever artifacts it produces and commit those exact files.

## Task 0: All DB schema changes + migration + new npm dependencies

**Files:**
- Modify: `web/src/db/schema.ts`
- Create: whichever migration file `drizzle-kit generate --name clinic_feature_pack` produces (accept Drizzle's numbering)
- Create: matching snapshot under `web/src/db/migrations/meta/`
- Modify: `web/src/db/migrations/meta/_journal.json` (Drizzle updates it)
- Modify: `web/package.json` + `pnpm-lock.yaml` (new deps: `react-image-crop`, `@sparticuz/chromium-min`, `puppeteer-core`)

- [ ] **Step 1: Add new tables to schema.ts**

Append after the existing tables (before the relations block, if any). Use the existing camelCase-in-TS / snake_case-in-DB convention.

```ts
// ─── BIRTHDAYS ───────────────────────────────────────────────────────

export const patientGreetings = floraclinSchema.table('patient_greetings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  occasionYear: integer('occasion_year').notNull(),
  greetedAt: timestamp('greeted_at', { withTimezone: true }).notNull().defaultNow(),
  greetedBy: uuid('greeted_by').notNull().references(() => users.id),
}, (table) => [
  uniqueIndex('uq_patient_greetings_patient_year').on(table.patientId, table.occasionYear),
  index('idx_patient_greetings_tenant_year').on(table.tenantId, table.occasionYear),
])

// ─── PACKAGES ────────────────────────────────────────────────────────

export const packageTemplates = floraclinSchema.table('package_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  defaultPrice: decimal('default_price', { precision: 10, scale: 2 }),
  validityMonths: integer('validity_months'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('idx_package_templates_tenant').on(table.tenantId),
])

export const packageTemplateLines = floraclinSchema.table('package_template_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  templateId: uuid('template_id').notNull().references(() => packageTemplates.id, { onDelete: 'cascade' }),
  procedureTypeId: uuid('procedure_type_id').notNull().references(() => procedureTypes.id),
  sessionsCount: integer('sessions_count').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, (table) => [
  index('idx_package_template_lines_template').on(table.templateId),
])

export const patientPackages = floraclinSchema.table('patient_packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  templateId: uuid('template_id').references(() => packageTemplates.id),
  name: varchar('name', { length: 255 }).notNull(),
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),
  purchasedAt: date('purchased_at').notNull(),
  expiresAt: date('expires_at'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: text('cancel_reason'),
  financialEntryId: uuid('financial_entry_id').notNull().references(() => financialEntries.id),
  soldBy: uuid('sold_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_patient_packages_tenant_patient').on(table.tenantId, table.patientId),
  index('idx_patient_packages_status').on(table.tenantId, table.status),
])

export const patientPackageLines = floraclinSchema.table('patient_package_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientPackageId: uuid('patient_package_id').notNull().references(() => patientPackages.id, { onDelete: 'cascade' }),
  procedureTypeId: uuid('procedure_type_id').notNull().references(() => procedureTypes.id),
  procedureTypeName: varchar('procedure_type_name', { length: 255 }).notNull(),
  sessionsTotal: integer('sessions_total').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, (table) => [
  index('idx_patient_package_lines_package').on(table.patientPackageId),
])

// ─── CLINICAL DOCUMENTS ──────────────────────────────────────────────

export const clinicalDocumentTemplates = floraclinSchema.table('clinical_document_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  kind: varchar('kind', { length: 20 }).notNull(), // CHECK: receita | atestado
  name: varchar('name', { length: 255 }).notNull(),
  body: text('body').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('idx_clinical_document_templates_tenant_kind').on(table.tenantId, table.kind),
])

export const clinicalDocuments = floraclinSchema.table('clinical_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  practitionerId: uuid('practitioner_id').notNull().references(() => users.id),
  kind: varchar('kind', { length: 20 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  body: text('body').notNull(),
  templateId: uuid('template_id').references(() => clinicalDocumentTemplates.id),
  professionalSnapshot: jsonb('professional_snapshot').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  deliveredVia: varchar('delivered_via', { length: 20 }).notNull(),
  whatsappMessageId: text('whatsapp_message_id'),
  storagePath: text('storage_path'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_clinical_documents_tenant_patient_issued').on(table.tenantId, table.patientId, table.issuedAt),
])

// ─── PROCEDURE FOLLOWUPS ─────────────────────────────────────────────

export const procedureFollowups = floraclinSchema.table('procedure_followups', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  procedureRecordId: uuid('procedure_record_id').notNull().references(() => procedureRecords.id, { onDelete: 'cascade' }),
  contactedBy: uuid('contacted_by').notNull().references(() => users.id),
  contactedAt: timestamp('contacted_at', { withTimezone: true }).notNull().defaultNow(),
  channel: varchar('channel', { length: 20 }).notNull(), // CHECK: whatsapp | call | in_person | other
  outcome: varchar('outcome', { length: 30 }).notNull(), // CHECK: agendou | pediu_para_aguardar | sem_resposta | desistiu | outro
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_procedure_followups_record_contacted').on(table.procedureRecordId, table.contactedAt),
])
```

- [ ] **Step 2: Add columns to existing tables**

Edit existing table definitions in `schema.ts`. Use Drizzle's column-add pattern (just append to the column block — Drizzle generates `ADD COLUMN`).

**`users` table** — add:
```ts
signatureData: text('signature_data'),
signatureUpdatedAt: timestamp('signature_updated_at', { withTimezone: true }),
professionalTitle: varchar('professional_title', { length: 100 }),
registryType: varchar('registry_type', { length: 10 }),
registryNumber: varchar('registry_number', { length: 20 }),
registryState: varchar('registry_state', { length: 2 }),
```

**`patients` table** — no column changes; only the expression index below.

**`photo_assets` table** — add:
```ts
cropBox: jsonb('crop_box'),
cropAspect: decimal('crop_aspect', { precision: 10, scale: 4 }),
```

**`procedure_records` table** — add (and add the matching indexes):
```ts
patientPackageId: uuid('patient_package_id').references(() => patientPackages.id),
patientPackageLineId: uuid('patient_package_line_id').references(() => patientPackageLines.id),
followupSnoozedUntil: date('followup_snoozed_until'),
lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
```

Add indexes:
```ts
index('idx_procedure_records_package_line').on(table.patientPackageLineId),
index('idx_procedure_records_followup_status').on(table.tenantId, table.status, table.followupSnoozedUntil),
```

- [ ] **Step 3: Generate the migration**

```bash
pnpm --filter @floraclin/web exec drizzle-kit generate --name clinic_feature_pack
```

Accept whatever filename and number Drizzle produces. Commit the produced SQL + the produced snapshot + the modified `_journal.json` exactly as written. Do not rename or renumber.

- [ ] **Step 3.5: Install new npm dependencies**

These are used by Group 2 tasks. Installing here avoids two parallel agents racing on `package.json` / `pnpm-lock.yaml`.

```bash
pnpm --filter @floraclin/web add react-image-crop @sparticuz/chromium-min puppeteer-core
```

Verify the install succeeded by running `pnpm --filter @floraclin/web typecheck` — Drizzle/types should still compile. (TS errors at this point would indicate a version-mismatch issue; address before continuing.)

- [ ] **Step 4: Augment generated SQL with CHECK constraints and the expression index**

Drizzle won't generate the CHECK constraints or the expression index. Append them to the bottom of `0012_clinic_feature_pack.sql`:

```sql
-- CHECK constraints
ALTER TABLE "floraclin"."patient_packages"
  ADD CONSTRAINT "patient_packages_status_check"
  CHECK ("status" IN ('active', 'completed', 'cancelled', 'expired'));

ALTER TABLE "floraclin"."clinical_document_templates"
  ADD CONSTRAINT "clinical_document_templates_kind_check"
  CHECK ("kind" IN ('receita', 'atestado'));

ALTER TABLE "floraclin"."clinical_documents"
  ADD CONSTRAINT "clinical_documents_kind_check"
  CHECK ("kind" IN ('receita', 'atestado'));

ALTER TABLE "floraclin"."clinical_documents"
  ADD CONSTRAINT "clinical_documents_delivered_via_check"
  CHECK ("delivered_via" IN ('whatsapp', 'print', 'download', 'multiple'));

ALTER TABLE "floraclin"."procedure_followups"
  ADD CONSTRAINT "procedure_followups_channel_check"
  CHECK ("channel" IN ('whatsapp', 'call', 'in_person', 'other'));

ALTER TABLE "floraclin"."procedure_followups"
  ADD CONSTRAINT "procedure_followups_outcome_check"
  CHECK ("outcome" IN ('agendou', 'pediu_para_aguardar', 'sem_resposta', 'desistiu', 'outro'));

ALTER TABLE "floraclin"."package_template_lines"
  ADD CONSTRAINT "package_template_lines_sessions_positive"
  CHECK ("sessions_count" > 0);

ALTER TABLE "floraclin"."patient_package_lines"
  ADD CONSTRAINT "patient_package_lines_sessions_positive"
  CHECK ("sessions_total" > 0);

ALTER TABLE "floraclin"."users"
  ADD CONSTRAINT "users_registry_type_check"
  CHECK ("registry_type" IS NULL OR "registry_type" IN ('CRM', 'CRO', 'CRBM', 'CRF', 'CREFITO', 'COREN', 'OTHER'));

-- Expression index for fast birthday lookups
CREATE INDEX IF NOT EXISTS "idx_patients_birth_md"
  ON "floraclin"."patients" (
    "tenant_id",
    EXTRACT(MONTH FROM "birth_date"),
    EXTRACT(DAY FROM "birth_date")
  )
  WHERE "deleted_at" IS NULL AND "birth_date" IS NOT NULL;
```

- [ ] **Step 5: Apply migration locally and verify**

```bash
pnpm --filter @floraclin/web exec drizzle-kit migrate
```

Expected: applies cleanly. If the developer has no local DB, this step is optional — CI will apply.

- [ ] **Step 6: Smoke-test schema by running typecheck**

```bash
pnpm typecheck
```

Expected: passes. Any "Property does not exist" error means schema additions and existing code references are out of sync — fix before commit.

- [ ] **Step 7: Commit**

```bash
git add web/src/db/schema.ts web/src/db/migrations/ web/package.json pnpm-lock.yaml
git commit -m "feat(db): add clinic feature pack schema, migration, and new deps"
```

---

# Group 1 — Backend foundations (8 parallel tasks)

Tasks: 1A, 1B, 1D, 1F, 1H, 1J, 1K, 1L. All file-disjoint. All depend only on Group 0 (schema + new deps).

All Group 1 tasks depend on Group 0 (schema must exist). They are file-disjoint from each other.

## Task 1A: Professional signature server + profile API (GET + PUT)

**Files:**
- Create: `web/src/lib/professional.ts`
- Create: `web/src/lib/__tests__/professional.test.ts`
- Modify: `web/src/app/api/profile/route.ts` (add `GET`; extend existing `PUT` to accept signature/registry)
- Create: `web/src/validations/professional.ts`

**Context:** the existing route at `web/src/app/api/profile/route.ts` is `PUT`-only and accepts `{ fullName, phone }`. There is NO `GET /api/profile` and NO `useProfile()` hook today. Tasks 2A, 2H, and 3 will need the GET path — add it here.

- [ ] **Step 1: Define the signature block type and helper**

In `web/src/lib/professional.ts`:

```ts
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'

export interface SignatureBlock {
  signatureDataUrl: string
  displayName: string
  registryLine: string // e.g., "CRM-SP 123.456"
}

export async function getSignatureBlock(userId: string): Promise<SignatureBlock | null> {
  const [user] = await db.select({
    fullName: users.fullName,
    signatureData: users.signatureData,
    professionalTitle: users.professionalTitle,
    registryType: users.registryType,
    registryNumber: users.registryNumber,
    registryState: users.registryState,
  }).from(users).where(eq(users.id, userId)).limit(1)

  if (!user || !user.signatureData || !user.registryType || !user.registryNumber || !user.registryState) {
    return null
  }

  return {
    signatureDataUrl: user.signatureData,
    displayName: user.professionalTitle || user.fullName,
    registryLine: `${user.registryType}-${user.registryState} ${user.registryNumber}`,
  }
}

export function isSignatureBlockComplete(user: {
  signatureData: string | null
  registryType: string | null
  registryNumber: string | null
  registryState: string | null
}): boolean {
  return Boolean(user.signatureData && user.registryType && user.registryNumber && user.registryState)
}
```

- [ ] **Step 2: Validation schema in `web/src/validations/professional.ts`**

```ts
import { z } from 'zod'

export const REGISTRY_TYPES = ['CRM', 'CRO', 'CRBM', 'CRF', 'CREFITO', 'COREN', 'OTHER'] as const

export const professionalProfileSchema = z.object({
  signatureData: z.string().regex(/^data:image\/(png|jpeg);base64,/).max(500_000).nullable().optional(),
  professionalTitle: z.string().min(1).max(100).nullable().optional(),
  registryType: z.enum(REGISTRY_TYPES).nullable().optional(),
  registryNumber: z.string().min(1).max(20).nullable().optional(),
  registryState: z.string().length(2).regex(/^[A-Z]{2}$/).nullable().optional(),
})
```

- [ ] **Step 3: Extend `app/api/profile/route.ts` PUT and add GET**

The existing handler is `PUT` (not PATCH). Merge `professionalProfileSchema` into the body validator. When `signatureData` is updated, also set `signatureUpdatedAt = new Date()`. Permission: a user can only update their own row (already the case via `ctx.userId`).

Also add a `GET` handler returning the current user's profile fields needed by other tasks:

```ts
export async function GET() {
  const ctx = await getAuthContext()
  const [user] = await db.select({
    id: users.id, fullName: users.fullName, email: users.email, phone: users.phone,
    signatureData: users.signatureData,
    signatureUpdatedAt: users.signatureUpdatedAt,
    professionalTitle: users.professionalTitle,
    registryType: users.registryType,
    registryNumber: users.registryNumber,
    registryState: users.registryState,
  }).from(users).where(eq(users.id, ctx.userId)).limit(1)
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ data: user })
}
```

The response shape `{ data: { ... } }` matches the rest of the API.

- [ ] **Step 4: Tests in `__tests__/professional.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { isSignatureBlockComplete } from '../professional'

describe('isSignatureBlockComplete', () => {
  it('returns true when all fields present', () => {
    expect(isSignatureBlockComplete({
      signatureData: 'data:image/png;base64,xxx',
      registryType: 'CRM',
      registryNumber: '123456',
      registryState: 'SP',
    })).toBe(true)
  })

  it('returns false when signature missing', () => {
    expect(isSignatureBlockComplete({
      signatureData: null,
      registryType: 'CRM',
      registryNumber: '123456',
      registryState: 'SP',
    })).toBe(false)
  })

  it('returns false when any registry field missing', () => {
    expect(isSignatureBlockComplete({
      signatureData: 'x',
      registryType: 'CRM',
      registryNumber: null,
      registryState: 'SP',
    })).toBe(false)
  })
})
```

Run: `pnpm --filter @floraclin/web vitest run src/lib/__tests__/professional.test.ts`. Expect: pass.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(profile): add signature and professional registry fields"
```

---

## Task 1B: ProfessionalSignatureBlock component

**Files:**
- Create: `web/src/components/professional/professional-signature-block.tsx`
- Create: `web/src/components/professional/__tests__/professional-signature-block.test.tsx`

- [ ] **Step 1: Component**

```tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

export interface ProfessionalSignatureBlockProps {
  signatureDataUrl: string
  displayName: string
  registryLine: string
  className?: string
}

export function ProfessionalSignatureBlock({
  signatureDataUrl,
  displayName,
  registryLine,
  className,
}: ProfessionalSignatureBlockProps) {
  return (
    <div className={cn('flex flex-col items-center text-center', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- dataURL, no remote fetch */}
      <img
        src={signatureDataUrl}
        alt={`Assinatura de ${displayName}`}
        className="h-24 max-w-[280px] object-contain"
      />
      <div className="mt-1 w-[280px] border-t border-black" />
      <div className="mt-2 text-sm font-medium">{displayName}</div>
      <div className="text-xs text-gray-700">{registryLine}</div>
    </div>
  )
}
```

- [ ] **Step 2: Test**

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProfessionalSignatureBlock } from '../professional-signature-block'

describe('ProfessionalSignatureBlock', () => {
  it('renders signature image, name, and registry line', () => {
    render(
      <ProfessionalSignatureBlock
        signatureDataUrl="data:image/png;base64,xxx"
        displayName="Dra. Joana Silva"
        registryLine="CRM-SP 123.456"
      />
    )
    expect(screen.getByAltText('Assinatura de Dra. Joana Silva')).toBeInTheDocument()
    expect(screen.getByText('Dra. Joana Silva')).toBeInTheDocument()
    expect(screen.getByText('CRM-SP 123.456')).toBeInTheDocument()
  })
})
```

Run + commit.

```bash
git commit -m "feat(components): add ProfessionalSignatureBlock"
```

---

## Task 1D: Birthdays backend (queries + API)

**Files:**
- Create: `web/src/lib/birthdays.ts`
- Create: `web/src/lib/__tests__/birthdays.test.ts`
- Create: `web/src/app/api/birthdays/route.ts` (GET)
- Create: `web/src/app/api/birthdays/[patientId]/greeting/route.ts` (POST, DELETE)
- Create: `web/src/db/queries/birthdays.ts`

- [ ] **Step 1: Query helper in `db/queries/birthdays.ts`**

```ts
import { db } from '@/db/client'
import { patients, patientGreetings } from '@/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { brToday } from '@/lib/dates'

export interface BirthdayRow {
  id: string
  fullName: string
  birthDate: string // YYYY-MM-DD
  phone: string
  ageTurning: number
  greetedAt: Date | null
  greetedByName: string | null
}

/**
 * Returns patients with birthdays in the BR-local month/day window [fromMd, toMd].
 * Handles year-wrap (e.g. Dec 28 → Jan 3) by passing two separate ranges.
 */
export async function getBirthdaysInRange(args: {
  tenantId: string
  monthDayPairs: Array<{ month: number; day: number }>
  currentYear: number
}): Promise<BirthdayRow[]> {
  if (args.monthDayPairs.length === 0) return []

  const conditions = args.monthDayPairs.map(({ month, day }) =>
    sql`(EXTRACT(MONTH FROM ${patients.birthDate}) = ${month} AND EXTRACT(DAY FROM ${patients.birthDate}) = ${day})`
  )

  const rows = await db
    .select({
      id: patients.id,
      fullName: patients.fullName,
      birthDate: patients.birthDate,
      phone: patients.phone,
      greetedAt: patientGreetings.greetedAt,
    })
    .from(patients)
    .leftJoin(
      patientGreetings,
      and(
        eq(patientGreetings.patientId, patients.id),
        eq(patientGreetings.occasionYear, args.currentYear)
      )
    )
    .where(
      and(
        eq(patients.tenantId, args.tenantId),
        isNull(patients.deletedAt),
        sql`${patients.birthDate} IS NOT NULL`,
        sql`(${sql.join(conditions, sql` OR `)})`
      )
    )

  return rows.map((r) => ({
    ...r,
    fullName: r.fullName!,
    birthDate: r.birthDate!,
    phone: r.phone!,
    ageTurning: args.currentYear - parseInt(r.birthDate!.slice(0, 4), 10),
    greetedByName: null, // populated in a join enrichment if needed
  }))
}
```

(`birthDate` is a Postgres `DATE` returned as a `YYYY-MM-DD` string; slicing the year is host-TZ-safe. Never `new Date(birthDate)` then `.getFullYear()` — that's a UTC parse on a calendar day.)

- [ ] **Step 2: Range builders in `lib/birthdays.ts`**

Use `@/lib/dates` helpers per `AGENTS.md`. Never bare `new Date(yyyymmdd)` or `parseISO + 'T12:00:00'` string concatenation — go through `parseBrDate`.

```ts
import { brToday, parseBrDate } from '@/lib/dates'
import { addDays } from 'date-fns'

export function birthdayMonthDayPairs(args: { from: string; to: string }): Array<{ month: number; day: number }> {
  const pairs: Array<{ month: number; day: number }> = []
  let cursor = parseBrDate(args.from, '12:00:00')
  const end = parseBrDate(args.to, '12:00:00')
  while (cursor.getTime() <= end.getTime()) {
    pairs.push({ month: cursor.getMonth() + 1, day: cursor.getDate() })
    cursor = addDays(cursor, 1)
  }
  // Feb 29 fallback: if Feb 28 is in the range AND current year is not a leap year, also include Feb 29
  const currentYear = parseInt(brToday().slice(0, 4), 10)
  const isLeap = (currentYear % 4 === 0 && currentYear % 100 !== 0) || currentYear % 400 === 0
  if (!isLeap && pairs.some((p) => p.month === 2 && p.day === 28)) {
    pairs.push({ month: 2, day: 29 })
  }
  return pairs
}

export function todayMonthDay(): { month: number; day: number } {
  const today = brToday() // 'YYYY-MM-DD' BR-anchored
  return {
    month: parseInt(today.slice(5, 7), 10),
    day: parseInt(today.slice(8, 10), 10),
  }
}
```

- [ ] **Step 3: GET /api/birthdays route**

```ts
// web/src/app/api/birthdays/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { requireTenant } from '@/lib/auth' // or whatever the existing auth helper is — check existing routes
import { brToday } from '@/lib/dates'
import { birthdayMonthDayPairs } from '@/lib/birthdays'
import { getBirthdaysInRange } from '@/db/queries/birthdays'

export async function GET(req: NextRequest) {
  const session = await requireTenant() // adapt to existing helper
  const url = new URL(req.url)
  const from = url.searchParams.get('from') || brToday()
  const to = url.searchParams.get('to') || from
  const pairs = birthdayMonthDayPairs({ from, to })
  const currentYear = parseInt(brToday().slice(0, 4), 10)
  const rows = await getBirthdaysInRange({ tenantId: session.tenantId, monthDayPairs: pairs, currentYear })
  return NextResponse.json({ data: rows })
}
```

> **Implementer note:** confirm the actual auth helper name used in this project by reading an existing API route (`web/src/app/api/patients/route.ts` is a good reference). Replace `requireTenant` with the right import.

- [ ] **Step 4: POST/DELETE /api/birthdays/[patientId]/greeting routes**

Implement two handlers. POST inserts/upserts `patient_greetings` for the given `occasionYear` (default to current BR year). DELETE removes the row for that year. Both verify the patient belongs to the caller's tenant before mutating.

```ts
// excerpt
const body = await req.json().catch(() => ({}))
const year = body.year ?? parseInt(brToday().slice(0, 4), 10)
await db.insert(patientGreetings)
  .values({ tenantId: session.tenantId, patientId, occasionYear: year, greetedBy: session.userId })
  .onConflictDoNothing()
```

- [ ] **Step 5: Test the date helpers**

```ts
// __tests__/birthdays.test.ts
import { describe, it, expect } from 'vitest'
import { birthdayMonthDayPairs } from '../birthdays'

describe('birthdayMonthDayPairs', () => {
  it('returns single pair for one-day range', () => {
    expect(birthdayMonthDayPairs({ from: '2026-05-27', to: '2026-05-27' })).toEqual([{ month: 5, day: 27 }])
  })

  it('returns inclusive range across days', () => {
    const pairs = birthdayMonthDayPairs({ from: '2026-05-27', to: '2026-05-29' })
    expect(pairs).toContainEqual({ month: 5, day: 27 })
    expect(pairs).toContainEqual({ month: 5, day: 28 })
    expect(pairs).toContainEqual({ month: 5, day: 29 })
  })

  it('crosses month boundary', () => {
    const pairs = birthdayMonthDayPairs({ from: '2026-01-31', to: '2026-02-02' })
    expect(pairs).toContainEqual({ month: 1, day: 31 })
    expect(pairs).toContainEqual({ month: 2, day: 1 })
    expect(pairs).toContainEqual({ month: 2, day: 2 })
  })
})
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(birthdays): add birthday queries, range helpers, and API routes"
```

---

## Task 1F: Photo cropping backend

**Files:**
- Create: `web/src/lib/photos.ts` (CSS render helper)
- Create: `web/src/lib/__tests__/photos.test.ts`
- Modify: `web/src/app/api/photos/route.ts` (accept `cropBox` and `cropAspect` on POST)
- Create: `web/src/app/api/photos/[id]/route.ts` (PATCH for crop changes)
- Modify: `web/src/validations/photo.ts` (add cropBox schema)

- [ ] **Step 1: Validation schema in `validations/photo.ts`**

Append to existing file:
```ts
export const cropBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.05).max(1),
  height: z.number().min(0.05).max(1),
})
export type CropBox = z.infer<typeof cropBoxSchema>
```

- [ ] **Step 2: Render helper in `lib/photos.ts`**

```ts
import type { CropBox } from '@/validations/photo'

export interface CroppedDisplayStyle {
  containerStyle: { aspectRatio: string }
  imageStyle: {
    width: string
    height: string
    objectFit: 'cover'
    objectPosition: string
    transform: string
  }
}

/**
 * Converts a normalized crop box to CSS that renders the cropped region
 * inside a fixed-aspect container. The image overflows the container in the
 * un-cropped dimension and is positioned/scaled so the crop region fills it.
 */
export function applyCrop(crop: CropBox | null, sourceAspect: number): CroppedDisplayStyle | null {
  if (!crop) return null
  const cropAspect = (crop.width / crop.height) * sourceAspect
  // Scale so the cropped region fills the container; translate so the crop's top-left aligns.
  const scaleX = 1 / crop.width
  const scaleY = 1 / crop.height
  return {
    containerStyle: { aspectRatio: `${cropAspect}` },
    imageStyle: {
      width: `${scaleX * 100}%`,
      height: `${scaleY * 100}%`,
      objectFit: 'cover',
      objectPosition: 'top left',
      transform: `translate(${-crop.x * 100 * scaleX}%, ${-crop.y * 100 * scaleY}%)`,
    },
  }
}
```

- [ ] **Step 3: PATCH /api/photos/[id] route**

Accept `{ cropBox: CropBox | null }`. Verify the photo's `tenantId` matches the caller; update `cropBox` and `cropAspect` (derived from source image dimensions stored on the asset). If the asset row doesn't yet have stored dimensions, fall back to extracting them via `sharp` at update time (only if `sharp` already a dep — check; otherwise skip and rely on the front end to send `cropAspect` along with `cropBox`).

> **Implementer note:** Easiest path for MVP — front end always sends `cropBox` AND `cropAspect` together (it already has the loaded image). Server stores both. No `sharp` dep needed.

Updated payload:
```ts
const patchBody = z.object({
  cropBox: cropBoxSchema.nullable(),
  cropAspect: z.number().positive().nullable(),
})
```

- [ ] **Step 4: Extend POST /api/photos to accept the same optional fields**

If `cropBox` is sent at upload time, store it alongside the new asset row.

- [ ] **Step 5: Test the render helper**

```ts
import { describe, it, expect } from 'vitest'
import { applyCrop } from '../photos'

describe('applyCrop', () => {
  it('returns null when crop is null', () => {
    expect(applyCrop(null, 1)).toBeNull()
  })

  it('computes container aspect from crop and source', () => {
    const style = applyCrop({ x: 0, y: 0, width: 0.5, height: 0.5 }, 1.5)
    expect(style?.containerStyle.aspectRatio).toBe('1.5')
  })

  it('scales image to fill container', () => {
    const style = applyCrop({ x: 0, y: 0, width: 0.5, height: 0.5 }, 1)
    expect(style?.imageStyle.width).toBe('200%')
    expect(style?.imageStyle.height).toBe('200%')
  })
})
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(photos): non-destructive crop storage and render helper"
```

---

## Task 1H: Packages backend

**Files:**
- Create: `web/src/db/queries/packages.ts`
- Create: `web/src/lib/packages.ts` (status logic, sale, session creation)
- Create: `web/src/lib/__tests__/packages.test.ts`
- Create: `web/src/validations/package.ts`
- Create: `web/src/app/api/package-templates/route.ts` (GET, POST)
- Create: `web/src/app/api/package-templates/[id]/route.ts` (PATCH, DELETE)
- Create: `web/src/app/api/patient-packages/route.ts` (POST — sale)
- Create: `web/src/app/api/patients/[id]/packages/route.ts` (GET — list patient packages)
- Create: `web/src/app/api/patient-packages/[id]/cancel/route.ts` (POST)
- Create: `web/src/app/api/patient-packages/[id]/lines/[lineId]/start-session/route.ts` (POST)

- [ ] **Step 1: Validation schemas**

```ts
// web/src/validations/package.ts
import { z } from 'zod'

export const packageTemplateLineSchema = z.object({
  procedureTypeId: z.string().uuid(),
  sessionsCount: z.number().int().min(1),
  sortOrder: z.number().int().default(0),
})

export const packageTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  defaultPrice: z.number().nonnegative().optional(),
  validityMonths: z.number().int().min(1).optional(),
  lines: z.array(packageTemplateLineSchema).min(1),
})

export const sellPackageSchema = z.object({
  patientId: z.string().uuid(),
  templateId: z.string().uuid().nullable(),
  name: z.string().min(1).max(255),
  totalAmount: z.number().nonnegative(),
  validityMonths: z.number().int().min(1).optional().nullable(),
  lines: z.array(z.object({
    procedureTypeId: z.string().uuid(),
    procedureTypeName: z.string().min(1).max(255),
    sessionsTotal: z.number().int().min(1),
  })).min(1),
  paymentMethod: z.enum(['pix', 'credit_card', 'debit_card', 'cash', 'transfer']),
  installmentCount: z.number().int().min(1).max(24).default(1),
})
```

- [ ] **Step 2: Sale logic in `lib/packages.ts`**

Reuse the existing `createFinancialEntry(tenantId, data, txDb)` helper from `web/src/db/queries/financial.ts:37` for the financial side of the sale — it already handles transactional creation of `financial_entries` + `installments`, due-date computation, and tenant verification. Do NOT hand-build installments.

```ts
import { db } from '@/db/client'
import { patientPackages, patientPackageLines } from '@/db/schema'
import { brToday, parseBrDate, toLocalYmd } from '@/lib/dates'
import { addMonths } from 'date-fns'
import { createFinancialEntry } from '@/db/queries/financial'

export async function sellPackage(args: {
  tenantId: string
  soldBy: string
  input: SellPackageInput // from validation
}): Promise<{ packageId: string; financialEntryId: string }> {
  return db.transaction(async (tx) => {
    // 1. Create financial entry + installments via existing helper
    const entry = await createFinancialEntry(args.tenantId, {
      patientId: args.input.patientId,
      description: args.input.name,
      totalAmount: args.input.totalAmount,
      installmentCount: args.input.installmentCount,
      paymentMethod: args.input.paymentMethod,
      createdBy: args.soldBy,
    }, tx)

    // 2. Compute expiresAt — BR-anchored, never bare new Date(ymd)
    const expiresAt = args.input.validityMonths
      ? toLocalYmd(addMonths(parseBrDate(brToday(), '12:00:00'), args.input.validityMonths))
      : null

    // 3. Create patient_packages row
    const [pkg] = await tx.insert(patientPackages).values({
      tenantId: args.tenantId,
      patientId: args.input.patientId,
      templateId: args.input.templateId,
      name: args.input.name,
      totalAmount: String(args.input.totalAmount),
      purchasedAt: brToday(),
      expiresAt,
      status: 'active',
      financialEntryId: entry.id,
      soldBy: args.soldBy,
    }).returning()

    // 4. Create patient_package_lines
    for (let i = 0; i < args.input.lines.length; i++) {
      const line = args.input.lines[i]
      await tx.insert(patientPackageLines).values({
        patientPackageId: pkg.id,
        procedureTypeId: line.procedureTypeId,
        procedureTypeName: line.procedureTypeName,
        sessionsTotal: line.sessionsTotal,
        sortOrder: i,
      })
    }

    return { packageId: pkg.id, financialEntryId: entry.id }
  })
}
```

> **Implementer note:** verify the actual shape of `CreateFinancialEntryInput` against `web/src/db/queries/financial.ts` before writing. Adjust field names if needed; the principle is "reuse the helper, don't reimplement it."

- [ ] **Step 3: Session starter — `startPackageSession` (race-safe)**

The check-then-insert pattern is race-prone: two staff members clicking "Iniciar próxima sessão" on the last available slot can both see remaining sessions and both create drafts, oversubscribing the package line.

Two mitigations applied together:
1. **Row lock the package line inside the transaction** (`SELECT … FOR UPDATE`).
2. **Count all non-cancelled records as consumed** (drafts and planned/approved hold the slot until they're cancelled), not just `executed`. This matches user mental model: starting a session "reserves" it.

```ts
import { sql, and, eq } from 'drizzle-orm'

export async function startPackageSession(args: {
  tenantId: string
  practitionerId: string
  patientPackageId: string
  patientPackageLineId: string
  allowExpiredOverride?: boolean
}): Promise<{ procedureRecordId: string }> {
  return db.transaction(async (tx) => {
    // 1. Lock the line row to serialize concurrent starts
    const [line] = await tx.execute<{
      id: string; patient_package_id: string; procedure_type_id: string; sessions_total: number
    }>(sql`
      SELECT id, patient_package_id, procedure_type_id, sessions_total
      FROM floraclin.patient_package_lines
      WHERE id = ${args.patientPackageLineId}
      FOR UPDATE
    `).then((r) => r.rows ?? r)

    if (!line) throw new Error('Line not found')

    const [pkg] = await tx.select().from(patientPackages)
      .where(eq(patientPackages.id, line.patient_package_id))
    if (!pkg || pkg.tenantId !== args.tenantId) throw new Error('Package not found')
    if (pkg.status === 'cancelled') throw new Error('Package is cancelled')
    if (pkg.status === 'expired' && !args.allowExpiredOverride) throw new Error('Package is expired')

    // 2. Count all non-cancelled records on this line (drafts + planned + approved + executed)
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` })
      .from(procedureRecords)
      .where(and(
        eq(procedureRecords.patientPackageLineId, args.patientPackageLineId),
        sql`${procedureRecords.status} != 'cancelled'`,
      ))
    if (count >= line.sessions_total) {
      throw new Error('Line fully consumed (including in-progress sessions)')
    }

    // 3. Create draft procedure record — still inside the lock
    const [record] = await tx.insert(procedureRecords).values({
      tenantId: args.tenantId,
      patientId: pkg.patientId,
      practitionerId: args.practitionerId,
      procedureTypeId: line.procedure_type_id,
      patientPackageId: pkg.id,
      patientPackageLineId: args.patientPackageLineId,
      status: 'draft',
    }).returning()

    return { procedureRecordId: record.id }
  })
}
```

> **Lifecycle note:** the created `draft` enters the normal procedure lifecycle. `procedure-page-client.tsx` (`web/src/app/(platform)/pacientes/[id]/procedimentos/[procedureId]/procedure-page-client.tsx`) routes drafts to `ProcedureForm` (planning), then approval, then execution. Package sessions follow this same path; the only difference is the pre-filled `procedureTypeId` and the `patientPackageId`/`patientPackageLineId` tags. Whether package sessions should skip the per-session contract approval (since the patient signed at sale time) is deferred to a follow-up — for MVP, each session goes through the standard approval flow.
>
> **Cancel/expire interlock:** `cancelPackage` and the lazy-expire writeback should also lock the package row (`FOR UPDATE`) before mutating to avoid status flips racing with new session starts.

- [ ] **Step 4: Auto-complete + auto-expire hook**

Add `maybeCompletePackage(packageId)` called after a procedure record's status flips to `executed`. Sums consumed counts; if every line is fully consumed, sets `patientPackages.status = 'completed'`.

```ts
export async function maybeCompletePackage(tenantId: string, patientPackageId: string): Promise<void> {
  const lines = await db.select().from(patientPackageLines).where(eq(patientPackageLines.patientPackageId, patientPackageId))
  for (const line of lines) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(procedureRecords)
      .where(and(
        eq(procedureRecords.patientPackageLineId, line.id),
        eq(procedureRecords.status, 'executed'),
      ))
    if (count < line.sessionsTotal) return // not yet
  }
  await db.update(patientPackages)
    .set({ status: 'completed', updatedAt: new Date() })
    .where(and(eq(patientPackages.id, patientPackageId), eq(patientPackages.tenantId, tenantId)))
}
```

Hook this into the existing procedure record status-transition path. Find it via grep: `grep -rn "status.*executed" web/src/app/api/procedures/ web/src/db/queries/procedures.ts`. Add a call to `maybeCompletePackage` whenever the record transitions to `executed` AND has `patientPackageId IS NOT NULL`.

- [ ] **Step 5: Computed-consumption query for the patient package card**

In `db/queries/packages.ts`:
```ts
export async function getPatientPackagesWithConsumption(tenantId: string, patientId: string) {
  // Returns: package rows + their lines + consumed-count per line (single SQL with GROUP BY on procedure_records).
  // Hint: subquery LEFT JOIN aggregating procedure_records by patientPackageLineId.
}
```

Implement using one SQL with `LEFT JOIN LATERAL (...)` or a simpler two-query approach (package lines, then a batched count grouped by lineId). Avoid N+1.

- [ ] **Step 6: API routes**

Wire the validation + lib functions into the routes listed in **Files**. All routes:
- Verify session/tenant.
- Use validators from `validations/package.ts`.
- Return `NextResponse.json(...)`.

For DELETE on package templates: soft-delete by setting `deletedAt`.

- [ ] **Step 7: Lazy-expire on read**

Add `WHERE (expires_at IS NULL OR expires_at >= CURRENT_DATE OR status != 'active')` and a write-back: when reading an `active` package whose `expires_at < brToday()`, update its status to `expired` opportunistically. This avoids the need for a cron job in MVP.

Implementer can centralize this in `getPatientPackagesWithConsumption` and the package list route.

- [ ] **Step 8: Tests**

Unit tests for `sellPackage` (mock DB or integration test using the project's existing test-db pattern — see how existing tests work via `grep -rn "describe" web/src/lib/__tests__/`).

At minimum:
- `birthdayMonthDayPairs`-style helper tests for the validity-month computation.
- `maybeCompletePackage` logic tests with table-driven counts.

- [ ] **Step 9: Commit**

```bash
git commit -m "feat(packages): templates, sales flow, session execution, and auto-complete"
```

---

## Task 1J: Followups backend (open planejamentos)

**Files:**
- Create: `web/src/db/queries/followups.ts`
- Create: `web/src/lib/followups.ts`
- Create: `web/src/lib/__tests__/followups.test.ts`
- Create: `web/src/validations/followup.ts`
- Create: `web/src/app/api/planejamentos/route.ts` (GET — list)
- Create: `web/src/app/api/procedures/[id]/followups/route.ts` (POST — record contact)
- Create: `web/src/app/api/procedures/[id]/snooze/route.ts` (PATCH)

- [ ] **Step 1: Validation in `validations/followup.ts`**

```ts
import { z } from 'zod'

export const FOLLOWUP_CHANNELS = ['whatsapp', 'call', 'in_person', 'other'] as const
export const FOLLOWUP_OUTCOMES = ['agendou', 'pediu_para_aguardar', 'sem_resposta', 'desistiu', 'outro'] as const

export const recordFollowupSchema = z.object({
  channel: z.enum(FOLLOWUP_CHANNELS),
  outcome: z.enum(FOLLOWUP_OUTCOMES),
  notes: z.string().max(2000).optional(),
})

export const snoozeSchema = z.object({
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
})
```

- [ ] **Step 2: Recording a followup in `lib/followups.ts`**

```ts
import { db } from '@/db/client'
import { procedureFollowups, procedureRecords } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

export async function recordFollowup(args: {
  tenantId: string
  contactedBy: string
  procedureRecordId: string
  channel: string
  outcome: string
  notes?: string
}): Promise<{ followupId: string; cancelledProcedure: boolean }> {
  return db.transaction(async (tx) => {
    const [proc] = await tx.select().from(procedureRecords).where(eq(procedureRecords.id, args.procedureRecordId))
    if (!proc || proc.tenantId !== args.tenantId) throw new Error('Procedure not found')

    const now = new Date()
    const [followup] = await tx.insert(procedureFollowups).values({
      tenantId: args.tenantId,
      procedureRecordId: args.procedureRecordId,
      contactedBy: args.contactedBy,
      contactedAt: now,
      channel: args.channel,
      outcome: args.outcome,
      notes: args.notes,
    }).returning()

    await tx.update(procedureRecords).set({ lastContactedAt: now, updatedAt: now })
      .where(eq(procedureRecords.id, args.procedureRecordId))

    let cancelledProcedure = false
    if (args.outcome === 'desistiu') {
      await tx.update(procedureRecords)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancellationReason: 'patient_declined',
          updatedAt: now,
        })
        .where(eq(procedureRecords.id, args.procedureRecordId))
      cancelledProcedure = true
    }

    return { followupId: followup.id, cancelledProcedure }
  })
}

export async function snoozeProcedure(args: {
  tenantId: string
  procedureRecordId: string
  until: string | null
}): Promise<void> {
  await db.update(procedureRecords)
    .set({ followupSnoozedUntil: args.until, updatedAt: new Date() })
    .where(and(
      eq(procedureRecords.id, args.procedureRecordId),
      eq(procedureRecords.tenantId, args.tenantId),
    ))
}
```

- [ ] **Step 3: List query for open planejamentos**

In `db/queries/followups.ts`:

```ts
export async function listOpenPlanejamentos(args: {
  tenantId: string
  practitionerId?: string
  procedureTypeId?: string
  includeSnoozed?: boolean
  limit?: number
}): Promise<OpenPlanejamentoRow[]> {
  const today = brToday()
  // SELECT procedure_records JOIN patients, procedure_types, users (practitioner)
  // WHERE tenantId matches, status IN ('planned','approved'), deletedAt IS NULL
  // AND (snoozedUntil IS NULL OR <= today OR includeSnoozed)
  // ORDER BY COALESCE(lastContactedAt, createdAt) ASC
}
```

Implement using Drizzle's join API. Return shape: `{ id, patientName, patientPhone, procedureTypeName, plannedDate, totalAmount, createdAt, lastContactedAt, snoozedUntil, status }`.

- [ ] **Step 4: API routes**

Three routes per **Files** section. Each verifies tenant membership; mutation routes call into `lib/followups.ts`.

- [ ] **Step 5: Tests**

Test the `recordFollowup` cancellation branch by mocking the transaction (or hitting a test DB if pattern exists).

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(followups): open planejamentos list, followup recording, and snooze"
```

---

## Task 1K: Shared print primitives (ClinicHeader)

**Files:**
- Create: `web/src/components/print/clinic-header.tsx`
- Create: `web/src/components/print/print-stylesheet.tsx`

Several Group 2 tasks need to render a clinic header and the same A4 print stylesheet (document print page, procedure record print page, document preview). Creating these once here avoids three Group-2 tasks racing for the same file.

- [ ] **Step 1: ClinicHeader**

Reads from a `tenant` row passed in (no internal data fetch). The caller is responsible for providing tenant info.

```tsx
import * as React from 'react'

interface Address {
  street?: string
  number?: string
  complement?: string
  neighborhood?: string
  city?: string
  state?: string
  zip?: string
}

export interface ClinicHeaderProps {
  tenant: {
    name: string
    phone: string | null
    email: string | null
    logoUrl: string | null
    address: Address | null
  }
  className?: string
}

function formatAddress(a: Address | null): string {
  if (!a) return ''
  const parts = [
    [a.street, a.number, a.complement].filter(Boolean).join(', '),
    [a.neighborhood, a.city, a.state].filter(Boolean).join(' · '),
    a.zip,
  ].filter(Boolean)
  return parts.join(' — ')
}

export function ClinicHeader({ tenant, className }: ClinicHeaderProps) {
  return (
    <header className={`flex items-center gap-4 border-b border-gray-300 pb-4 ${className ?? ''}`}>
      {tenant.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tenant.logoUrl} alt={tenant.name} className="h-16 w-16 object-contain" />
      )}
      <div className="flex-1">
        <div className="text-lg font-semibold">{tenant.name}</div>
        {tenant.address && <div className="text-xs text-gray-700">{formatAddress(tenant.address)}</div>}
        <div className="text-xs text-gray-700">
          {[tenant.phone, tenant.email].filter(Boolean).join(' · ')}
        </div>
      </div>
    </header>
  )
}
```

- [ ] **Step 2: PrintStylesheet**

```tsx
'use client'
import * as React from 'react'

export function PrintStylesheet() {
  return (
    <style jsx global>{`
      @media print {
        body { background: white; }
        @page { size: A4; margin: 20mm; }
        nav, aside, .no-print { display: none !important; }
      }
      .print-document { font-family: 'Times New Roman', Times, serif; line-height: 1.6; }
    `}</style>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(print): shared ClinicHeader and print stylesheet"
```

---

## Task 1L: Shared placeholder/template renderer

**Files:**
- Create: `web/src/lib/templates/placeholders.ts`
- Create: `web/src/lib/templates/__tests__/placeholders.test.ts`

The existing `resolveTemplateBody` in `web/src/lib/whatsapp.ts:248` already implements a placeholder system for WhatsApp templates. Extract a generic version here that BOTH the WhatsApp send path and the new clinical-documents path will consume. This satisfies the spec's "Reuse the existing template renderer" requirement and prevents drift.

- [ ] **Step 1: Generic renderer**

```ts
// web/src/lib/templates/placeholders.ts
export interface PlaceholderDescriptor {
  token: string // e.g. "{{patient.name}}"
  description: string // human-readable label in pt-BR
}

export function renderPlaceholders(body: string, values: Record<string, string>): string {
  let out = body
  for (const [token, value] of Object.entries(values)) {
    out = out.split(token).join(value ?? '')
  }
  return out
}
```

The escape-friendly `split().join()` avoids regex special-char issues that `replaceAll` would have on tokens containing `$`.

- [ ] **Step 2: Document context builder**

```ts
export interface DocumentContextInput {
  patient: { fullName: string; cpf: string | null; birthDate: string | null }
  practitioner: { displayName: string; registryLine: string }
  tenant: { name: string; address: { city?: string; state?: string } | null }
  date: Date
}

const LONG_DATE = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })

export function buildDocumentPlaceholders(ctx: DocumentContextInput): Record<string, string> {
  const city = ctx.tenant.address?.city ?? '' // empty if not set — never split a string
  const dateLong = LONG_DATE.format(ctx.date)
  return {
    '{{patient.name}}': ctx.patient.fullName,
    '{{patient.cpf}}': ctx.patient.cpf ?? '',
    '{{patient.birthDate}}': ctx.patient.birthDate ?? '',
    '{{date}}': ctx.date.toLocaleDateString('pt-BR'),
    '{{date.long}}': city ? `${city}, ${dateLong}` : dateLong,
    '{{practitioner.name}}': ctx.practitioner.displayName,
    '{{practitioner.registry}}': ctx.practitioner.registryLine,
    '{{tenant.name}}': ctx.tenant.name,
  }
}

export const AVAILABLE_DOCUMENT_PLACEHOLDERS: PlaceholderDescriptor[] = [
  { token: '{{patient.name}}', description: 'Nome do paciente' },
  { token: '{{patient.cpf}}', description: 'CPF' },
  { token: '{{patient.birthDate}}', description: 'Data de nascimento' },
  { token: '{{date}}', description: 'Data atual (DD/MM/AAAA)' },
  { token: '{{date.long}}', description: 'Data por extenso (com cidade)' },
  { token: '{{practitioner.name}}', description: 'Nome do profissional' },
  { token: '{{practitioner.registry}}', description: 'Registro profissional (ex: CRM-SP 12345)' },
  { token: '{{tenant.name}}', description: 'Nome da clínica' },
]
```

City is pulled from `tenant.address.city` (structured JSONB), not from string-splitting the tenant name. If the address is missing the city, the long-date format omits the city prefix — never invent one.

- [ ] **Step 3: Optional follow-up — converge WhatsApp template renderer**

Inside `lib/whatsapp.ts`, replace the inline placeholder substitution with `renderPlaceholders(body, whatsappPlaceholders)`. Keep behavior identical (run the existing WhatsApp tests to verify).

This step is optional for MVP — if it touches too many existing tests, defer to a follow-up commit. Document the deferral in the commit message.

- [ ] **Step 4: Tests**

```ts
import { describe, it, expect } from 'vitest'
import { renderPlaceholders, buildDocumentPlaceholders } from '../placeholders'

describe('renderPlaceholders', () => {
  it('replaces tokens', () => {
    expect(renderPlaceholders('Hello {{n}}', { '{{n}}': 'world' })).toBe('Hello world')
  })
  it('handles tokens containing regex special chars', () => {
    expect(renderPlaceholders('a${{x}}b', { '{{x}}': 'Y' })).toBe('a$Yb')
  })
  it('replaces all occurrences', () => {
    expect(renderPlaceholders('{{n}}-{{n}}', { '{{n}}': 'a' })).toBe('a-a')
  })
})

describe('buildDocumentPlaceholders', () => {
  it('omits city in date.long when address has no city', () => {
    const map = buildDocumentPlaceholders({
      patient: { fullName: 'X', cpf: null, birthDate: null },
      practitioner: { displayName: 'Y', registryLine: 'CRM-SP 1' },
      tenant: { name: 'Z', address: null },
      date: new Date('2026-05-27T15:00:00Z'),
    })
    expect(map['{{date.long}}']).not.toContain(',')
  })
})
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(templates): shared placeholder renderer for documents and WhatsApp"
```

---

# Group 2 — Topic UIs + Documents full stack (7 parallel tasks)

Tasks: 2A, 2B, 2C, 2D, 2E, 2F, 2J. All file-disjoint. All depend on Group 1 (specifically: Task 2A and 2F depend on 1A's profile API; 2F and 2J depend on 1K's ClinicHeader; 2F depends on 1L's placeholder renderer).

All Group 2 tasks depend on Group 1 being merged. Tasks within Group 2 are file-disjoint.

## Task 2A: Professional signature profile UI section

**Files:**
- Modify or create: `web/src/app/(platform)/configuracoes/perfil/page.tsx` (check if it exists; if not, create the route)
- Create: `web/src/components/settings/professional-signature-form.tsx`
- Create: `web/src/hooks/queries/use-profile.ts` (extend existing if it exists)

- [ ] **Step 1: Find or create the profile page**

```bash
find web/src/app -type d -name "perfil" 2>/dev/null
grep -rln "professionalTitle\|profile.*form" web/src/components/settings/ 2>/dev/null
```

If a profile page exists, add a new section to it. If not, create `app/(platform)/configuracoes/perfil/page.tsx` and the matching client.

- [ ] **Step 2: Form component**

A client component with:
- `<SignaturePad>` (existing in `components/consent/signature-pad.tsx`) for drawing
- "Carregar imagem" button → reads selected file, base64-encodes (max 500 KB), validates image MIME type, calls `onSignatureChange(dataUrl)`
- Form fields: `professionalTitle`, `registryType` (Select with REGISTRY_TYPES), `registryNumber`, `registryState` (Select of UFs)
- Live preview using `<ProfessionalSignatureBlock>` (from Task 1B)
- "Salvar" submits via PATCH to `/api/profile`
- "Limpar assinatura" sends `{ signatureData: null }`

Use React Query `useMutation` per existing patterns in `web/src/hooks/queries/`.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(profile): signature pad + registry fields in profile settings"
```

---

## Task 2B: Birthday dashboard widget + full page

**Files:**
- Create: `web/src/components/dashboard/upcoming-birthdays-card.tsx`
- Create: `web/src/hooks/queries/use-birthdays.ts`
- Create: `web/src/app/(platform)/pacientes/aniversariantes/page.tsx`
- Create: `web/src/app/(platform)/pacientes/aniversariantes/aniversariantes-page-client.tsx`
- Create: `web/src/components/patients/birthday-row-actions.tsx` (WhatsApp + greeted toggle — shared between card and page)

- [ ] **Step 1: useBirthdays hook**

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export function useBirthdays(args: { from: string; to: string }) {
  return useQuery({
    queryKey: ['birthdays', args.from, args.to],
    queryFn: async () => {
      const res = await fetch(`/api/birthdays?from=${args.from}&to=${args.to}`)
      if (!res.ok) throw new Error('Failed to load birthdays')
      return (await res.json()).data
    },
  })
}

export function useToggleGreeting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { patientId: string; greeted: boolean; year: number }) => {
      const url = `/api/birthdays/${args.patientId}/greeting`
      const res = await fetch(url, { method: args.greeted ? 'POST' : 'DELETE', body: JSON.stringify({ year }) })
      if (!res.ok) throw new Error('Failed')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['birthdays'] }),
  })
}
```

- [ ] **Step 2: Dashboard widget `<UpcomingBirthdaysCard>`**

Self-fetches "today" by default. Shows count of "+N esta semana" by also fetching the 7-day window. Renders up to 5 rows of `<BirthdayRowActions>`. Empty-state copy: "Ninguém faz aniversário hoje".

- [ ] **Step 3: Full page**

Filters: month select (defaults to current BR month), search input. Table with rows. Reuses `<BirthdayRowActions>`.

- [ ] **Step 4: BirthdayRowActions**

Renders: WhatsApp button (links to `/whatsapp?patient=<id>` or whatever the existing pattern is — grep `whatsappConversationId` for the URL pattern), and greeted toggle bound to `useToggleGreeting`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(birthdays): dashboard widget and aniversariantes page"
```

---

## Task 2C: ImageCropper component + integrations

**Files:**
- Create: `web/src/components/photos/image-cropper.tsx`
- Create: `web/src/hooks/queries/use-photo-crop.ts`
- Modify: `web/src/components/photos/photo-uploader.tsx`
- Modify: `web/src/components/photos/photo-grid.tsx` (the per-photo card lives here — it renders the action buttons consumed by `patient-photos-tab.tsx` and `execution-photo-section.tsx`)
- Modify: `web/src/components/photos/photo-comparison.tsx`
- Modify: `web/src/components/patients/patient-photos-tab.tsx` (only if a prop or action handler needs threading through)
- Modify: `web/src/components/procedures/execution/execution-photo-section.tsx` (only if a prop or action handler needs threading through)

Note: `react-image-crop` is already installed in Task 0; this task only imports it.

- [ ] **Step 1: Skipped — dep installed in Task 0**

- [ ] **Step 2: ImageCropper component**

Wrapper around `<ReactCrop>` from `react-image-crop`. Props:
```ts
interface ImageCropperProps {
  src: string
  currentCrop: CropBox | null
  sourceAspect: number // width / height of the underlying image
  onSave: (crop: CropBox | null) => void
  onCancel: () => void
}
```

Inside the cropper:
- Initial crop set from `currentCrop` (or full image if null).
- `aspect` prop set to `sourceAspect` (locked aspect per spec).
- Two buttons: "Salvar recorte" → `onSave(box)`, "Remover recorte" → `onSave(null)`. Show "Remover" only if `currentCrop != null`.
- Reject boxes that render at <50px (use the loaded image's natural width/height to compute).

- [ ] **Step 3: usePhotoCrop hook**

```ts
export function useUpdatePhotoCrop() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { photoId: string; cropBox: CropBox | null; cropAspect: number | null }) => {
      const res = await fetch(`/api/photos/${args.photoId}`, {
        method: 'PATCH',
        body: JSON.stringify(args),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['photos'] }),
  })
}
```

- [ ] **Step 4: Integrate into photo-uploader.tsx**

After a file is queued, add a "Recortar" button on the preview. Opens `<ImageCropper>` in a modal. On save, attach `cropBox` and `cropAspect` to the upload request. (POST /api/photos already extended in Task 1F.)

- [ ] **Step 5: Integrate into photo-grid.tsx**

The actual per-photo card lives here. Add a "Recortar" action button (next to the existing actions). Opens cropper modal with existing src + currentCrop. On save, call `useUpdatePhotoCrop`. On view, render the photo via `applyCrop` helper (from Task 1F). Both `patient-photos-tab.tsx` and `execution-photo-section.tsx` compose `PhotoGrid` — they inherit the new action automatically.

- [ ] **Step 6: Integrate into photo-comparison.tsx**

Add a "Recortar" button on each side. Same modal flow.

- [ ] **Step 7: Minor prop threading**

If `patient-photos-tab.tsx` or `execution-photo-section.tsx` need to pass a callback or refetch handler down to `PhotoGrid` for cache invalidation, add that here. Many cases will not need any change.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(photos): non-destructive cropping in uploader, gallery, and comparison view"
```

---

## Task 2D: Package settings + sales wizard + patient packages tab component

**Files:**
- Create: `web/src/app/(platform)/configuracoes/pacotes/page.tsx`
- Create: `web/src/app/(platform)/configuracoes/pacotes/pacotes-page-client.tsx`
- Create: `web/src/components/packages/package-template-form.tsx`
- Create: `web/src/components/packages/package-template-list.tsx`
- Create: `web/src/components/packages/sell-package-dialog.tsx`
- Create: `web/src/components/packages/patient-packages-tab.tsx` (tab content — wiring into the tab system happens in Group 3)
- Create: `web/src/components/packages/package-card.tsx`
- Create: `web/src/hooks/queries/use-packages.ts`

- [ ] **Step 1: useQueries hooks**

`usePackageTemplates`, `usePatientPackages(patientId)`, `useSellPackage`, `useCancelPackage`, `useStartPackageSession`.

- [ ] **Step 2: Package template settings page**

List + create/edit/archive UI. Form (PackageTemplateForm) repeats lines (procedure type select + sessions input + remove). Use existing procedure types via the existing `useProcedureTypes` hook (find via `grep -rn "useProcedureTypes" web/src/hooks`).

- [ ] **Step 3: SellPackageDialog**

Multi-step modal:
1. Pick template (radio list) OR "Pacote personalizado".
2. Review/edit lines, set name + total price + validity.
3. Choose payment method + installments (reuse existing financial-entry form pattern; grep `installmentCount` for a reference).
4. Confirm → `useSellPackage`.

- [ ] **Step 4: PackageCard**

Shows package metadata + per-line progress bars + "Iniciar próxima sessão" button per line. On click, calls `useStartPackageSession` which returns the new draft `procedureRecordId`, then navigates to the existing execution flow (`/pacientes/[id]/procedimentos/[procedureId]`).

Overflow menu: "Cancelar pacote" → confirm dialog with reason field → `useCancelPackage`.

- [ ] **Step 5: PatientPackagesTab**

Lists active packages (collapsed completed/cancelled section below). Each renders a `<PackageCard>`. Empty state: "Nenhum pacote ativo. [Vender pacote]".

> **Implementer note:** the "Vender pacote" button on the patient profile is added in Group 3 (wiring task) since it modifies the patient header.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(packages): templates settings page, sales wizard, and patient packages tab"
```

---

## Task 2E: Open planejamentos UI

**Files:**
- Create: `web/src/components/dashboard/open-planejamentos-card.tsx`
- Create: `web/src/components/planejamentos/followup-modal.tsx`
- Create: `web/src/components/planejamentos/snooze-modal.tsx`
- Create: `web/src/components/planejamentos/followup-timeline.tsx`
- Create: `web/src/components/planejamentos/planejamentos-table.tsx`
- Create: `web/src/app/(platform)/crm/planejamentos/page.tsx`
- Create: `web/src/app/(platform)/crm/planejamentos/planejamentos-page-client.tsx`
- Create: `web/src/hooks/queries/use-planejamentos.ts`

- [ ] **Step 1: Hooks**

`useOpenPlanejamentos(filters)`, `useRecordFollowup`, `useSnoozeProcedure`. Patterns match existing `useProcedures` (`web/src/hooks/queries/use-procedures.ts`).

- [ ] **Step 2: Dashboard widget**

Fetches `useOpenPlanejamentos({ limit: 5, sort: 'stalest' })`. Header + count + top 5 rows. Each row has WhatsApp button. Footer link to `/crm/planejamentos`.

- [ ] **Step 3: Full page table**

Filters (practitioner, procedureType, value range, includeSnoozed). Default sort stalest first. Rows are clickable to procedure record page. Row actions: "Registrar contato" (opens FollowupModal), "Enviar WhatsApp", "Adiar até..." (opens SnoozeModal).

- [ ] **Step 4: FollowupModal**

Form: channel (radio), outcome (radio), notes (textarea). On submit, `useRecordFollowup`. If response indicates the procedure was auto-cancelled (outcome `desistiu`), show toast: "Planejamento cancelado conforme registro."

- [ ] **Step 5: SnoozeModal**

Date picker (must be > today). On submit, `useSnoozeProcedure({ until })`. "Remover adiamento" → `useSnoozeProcedure({ until: null })`.

- [ ] **Step 6: FollowupTimeline**

Reusable list of followup entries (used inside the procedure record page in Group 3). Shows date, contactedBy avatar, channel icon, outcome chip, notes.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(planejamentos): dashboard widget, page, followup modal, and snooze"
```

---

## Task 2F: Clinical documents — full stack (one owner)

Originally split across 2F/2G/2H/2I (backend, templates page, issuance UI, print page). The documents stack is deeply intertwined — backend `professionalSnapshot` shape, preview component, print page React tree, and PDF rendering all share types and rendering logic. Splitting created file-ownership conflicts and a hidden inter-task dependency chain. Consolidating into one task with a single owner removes those entirely.

**Files:**
Backend:
- Create: `web/src/lib/clinical-documents.ts` (snapshot creation, send-whatsapp orchestration)
- Create: `web/src/lib/__tests__/clinical-documents.test.ts`
- Create: `web/src/lib/pdf.ts` (React tree → PDF via headless Chromium; **NO internal HTTP loop**)
- Create: `web/src/db/queries/clinical-documents.ts`
- Create: `web/src/validations/clinical-document.ts`
- Create: `web/src/app/api/document-templates/route.ts` (GET, POST)
- Create: `web/src/app/api/document-templates/[id]/route.ts` (PATCH, DELETE)
- Create: `web/src/app/api/clinical-documents/route.ts` (POST — issue)
- Create: `web/src/app/api/clinical-documents/[id]/pdf/route.ts` (GET — stream PDF, **authenticated**)
- Create: `web/src/app/api/clinical-documents/[id]/send-whatsapp/route.ts` (POST)
- Create: `web/src/app/api/patients/[id]/documents/route.ts` (GET — history)

Templates settings UI:
- Create: `web/src/app/(platform)/configuracoes/documentos/page.tsx`
- Create: `web/src/app/(platform)/configuracoes/documentos/documentos-page-client.tsx`
- Create: `web/src/components/settings/document-template-form.tsx`
- Create: `web/src/components/settings/document-template-list.tsx`

Issuance + delivery UI:
- Create: `web/src/components/clinical-documents/issue-document-dialog.tsx`
- Create: `web/src/components/clinical-documents/document-preview.tsx`
- Create: `web/src/components/clinical-documents/patient-documents-tab.tsx`
- Create: `web/src/components/clinical-documents/delivery-actions.tsx`
- Create: `web/src/components/clinical-documents/print-document.tsx` (shared between authenticated print page and PDF rendering)
- Create: `web/src/hooks/queries/use-clinical-documents.ts`
- Create: `web/src/hooks/queries/use-document-templates.ts`

Authenticated print page (NOT public):
- Create: `web/src/app/(platform)/documentos/[id]/imprimir/page.tsx`
- Create: `web/src/app/(platform)/documentos/[id]/imprimir/print-document-page-client.tsx`

Dependencies (`@sparticuz/chromium-min`, `puppeteer-core`) already installed in Task 0.

- [ ] **Step 1: Use shared placeholder renderer**

Import `renderPlaceholders`, `buildDocumentPlaceholders`, and `AVAILABLE_DOCUMENT_PLACEHOLDERS` from `@/lib/templates/placeholders` (created in Task 1L). Do NOT create a second placeholder system here.

- [ ] **Step 3: Issue function**

```ts
import { getSignatureBlock } from '@/lib/professional'

export async function issueClinicalDocument(args: {
  tenantId: string
  practitionerId: string
  patientId: string
  kind: 'receita' | 'atestado'
  title: string
  body: string
  templateId?: string | null
}): Promise<{ id: string }> {
  const sig = await getSignatureBlock(args.practitionerId)
  if (!sig) throw new Error('Profissional sem assinatura/registro configurados')

  const [doc] = await db.insert(clinicalDocuments).values({
    tenantId: args.tenantId,
    patientId: args.patientId,
    practitionerId: args.practitionerId,
    kind: args.kind,
    title: args.title,
    body: args.body,
    templateId: args.templateId ?? null,
    professionalSnapshot: {
      name: sig.displayName,
      registryLine: sig.registryLine,
      signatureDataUrl: sig.signatureDataUrl,
    },
    deliveredVia: 'download', // updated by delivery endpoints
  }).returning()
  return { id: doc.id }
}
```

- [ ] **Step 4: PDF generation in `lib/pdf.ts` — server-side render, no HTTP loop**

The previous draft fetched the print page via HTTP from the PDF route. That couples backend to the public route, leaks cookies through the loop, and adds latency. Instead, render the React tree to HTML server-side using `react-dom/server`.

```ts
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium-min'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'

// Pin to whatever the installed @sparticuz/chromium-min recommends.
// Implementer: check node_modules/@sparticuz/chromium-min/README.md for the version-matched URL.
const CHROMIUM_PACK_URL = process.env.CHROMIUM_PACK_URL
  ?? 'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar'

export async function renderReactToPdf(tree: ReactElement, baseStyles: string): Promise<Buffer> {
  const bodyMarkup = renderToStaticMarkup(tree)
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${baseStyles}</style></head><body>${bodyMarkup}</body></html>`
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
    headless: true,
  })
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}

export const PRINT_BASE_CSS = `
  body { font-family: 'Times New Roman', Times, serif; line-height: 1.6; color: black; }
  header { display: flex; align-items: center; gap: 1rem; border-bottom: 1px solid #999; padding-bottom: 1rem; }
  header img { height: 64px; width: 64px; object-fit: contain; }
  h1 { font-size: 18px; margin: 1.5rem 0 0.5rem 0; }
  .body { white-space: pre-wrap; margin-top: 1rem; }
  .footer { margin-top: 4rem; text-align: center; }
  .footer img { height: 96px; max-width: 280px; object-fit: contain; }
  .footer .line { border-top: 1px solid black; margin: 0.25rem auto 0 auto; width: 280px; }
  .footer .name { margin-top: 0.5rem; font-weight: 500; }
  .footer .registry { font-size: 12px; color: #555; }
`
```

> **Implementer note:** the chromium pack version is the single most likely deployment failure point. Run a smoke render after install (`node -e "require('@sparticuz/chromium-min').executablePath('<URL>').then(p => console.log(p))"`) to confirm. Allow override via `CHROMIUM_PACK_URL` env var for production tuning.

- [ ] **Step 5: PDF route — authenticated**

```ts
// app/api/clinical-documents/[id]/pdf/route.ts
import { renderReactToPdf, PRINT_BASE_CSS } from '@/lib/pdf'
import { getAuthContext } from '@/lib/auth'
import { getClinicalDocumentWithContext } from '@/db/queries/clinical-documents'
import { PrintDocument } from '@/components/clinical-documents/print-document'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuthContext()
  const { id } = await ctx.params
  const doc = await getClinicalDocumentWithContext(auth.tenantId, id)
  if (!doc) return new NextResponse('Not found', { status: 404 })

  // Render the print component to a PDF buffer directly — no internal HTTP fetch.
  const pdf = await renderReactToPdf(<PrintDocument doc={doc} tenant={doc.tenant} />, PRINT_BASE_CSS)
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${doc.kind}-${id}.pdf"`,
    },
  })
}
```

`PrintDocument` is a shared component that uses `<ClinicHeader>` (from Task 1K) and `<ProfessionalSignatureBlock>` (from Task 1B). The same component renders the authenticated print page (`/documentos/[id]/imprimir`).

- [ ] **Step 5b: Authenticated print page** at `app/(platform)/documentos/[id]/imprimir/page.tsx`

This is an internal staff-only route — sits under `(platform)` so existing session middleware applies. The same `<PrintDocument>` component renders here for browser printing. NEVER use a public `/c/...` URL for clinical documents.

```tsx
export default async function PrintDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthContext()
  const { id } = await params
  const doc = await getClinicalDocumentWithContext(auth.tenantId, id)
  if (!doc) notFound()
  return (
    <>
      <PrintStylesheet />
      <PrintDocument doc={doc} tenant={doc.tenant} />
    </>
  )
}
```

- [ ] **Step 6: send-whatsapp route**

```ts
// app/api/clinical-documents/[id]/send-whatsapp/route.ts
import { sendMediaMessage } from '@/lib/whatsapp'
import { uploadPdfBuffer } from '@/lib/storage' // see Storage note below
import { renderReactToPdf, PRINT_BASE_CSS } from '@/lib/pdf'
import { PrintDocument } from '@/components/clinical-documents/print-document'

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuthContext()
  const { id } = await ctx.params
  const doc = await getClinicalDocumentWithContext(auth.tenantId, id)
  if (!doc) return new NextResponse('Not found', { status: 404 })

  const pdfBuffer = await renderReactToPdf(<PrintDocument doc={doc} tenant={doc.tenant} />, PRINT_BASE_CSS)
  const { url, storagePath } = await uploadPdfBuffer({
    tenantId: auth.tenantId,
    patientId: doc.patientId,
    fileName: `${doc.kind}-${id}.pdf`,
    buffer: pdfBuffer,
    visibility: 'signed', // long-lived signed URL — Meta needs to fetch it
  })

  const result = await sendMediaMessage({
    tenantId: auth.tenantId,
    to: doc.patientPhone,
    mediaUrl: url,
    mediaType: 'document',
    filename: `${doc.title}.pdf`,
  })

  await db.update(clinicalDocuments).set({
    deliveredVia: doc.deliveredVia === 'download' ? 'whatsapp' : 'multiple',
    whatsappMessageId: result.messageId,
    storagePath,
    updatedAt: new Date(),
  }).where(eq(clinicalDocuments.id, id))

  return NextResponse.json({ ok: true })
}
```

> **Storage note:** the existing `web/src/lib/storage.ts` is browser-File-based (signed URL pattern for client uploads). The PDF send path needs a **server-side Buffer upload** that produces a **fetchable URL Meta can reach**. Two options:
> 1. Extend `lib/storage.ts` with `uploadPdfBuffer({ buffer, ... })` that uses the Supabase service-role client server-side to upload to a `clinical-documents/` bucket path, then creates a long-lived signed URL (24h+).
> 2. If a `service_role` storage path doesn't exist yet, create `web/src/lib/storage-server.ts` with the service-role client and keep the buffer-upload helper there.
>
> Whichever you choose, the URL must be reachable by Meta for at least the duration of message delivery. The implementer should verify the existing storage bucket name and policies before writing this code (grep `STORAGE_BUCKET` / `supabaseAdmin` in `web/src/lib/`).

- [ ] **Step 7: Templates settings page**

Build `app/(platform)/configuracoes/documentos/` with tabs Receitas | Atestados. Within each tab: list + "Novo modelo" button. Form (a Sheet/Dialog) with name + body textarea + a sidebar listing `AVAILABLE_DOCUMENT_PLACEHOLDERS` (from Task 1L), each clickable to insert at cursor. Mirror the existing WhatsApp template management UI (check `web/src/components/settings/` for the pattern).

- [ ] **Step 8: Issuance wizard**

`<IssueDocumentDialog>` opened from the patient profile via the "Novo documento" button (added in Group 3).

Steps:
1. Kind selector (Receita / Atestado).
2. Template picker (optional) + title input + body textarea. Body field shows the resolved preview on the right via `<DocumentPreview>`.
3. After submit (POST `/api/clinical-documents`): renders `<DeliveryActions documentId={id} />` — three buttons (Imprimir, Baixar PDF, Enviar WhatsApp).

Guard at the start of step 1: if the practitioner lacks signature/registry, block with a CTA pointing to `/configuracoes/perfil`. Use the new `useProfile()` hook (call `GET /api/profile`).

```ts
// inside use-clinical-documents.ts
export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const res = await fetch('/api/profile')
      if (!res.ok) throw new Error('Failed')
      return (await res.json()).data as ProfileResponse
    },
  })
}
```

- [ ] **Step 9: DocumentPreview component**

Same structure as `<PrintDocument>` but used on-screen during the wizard. Both share the layout React tree — extract it into `<print-document.tsx>` and reuse from preview + print page + PDF render.

- [ ] **Step 10: DeliveryActions component**

Three buttons. **Imprimir** opens new tab to `/documentos/[id]/imprimir` (the authenticated route, NOT public). **Baixar PDF** triggers a hidden anchor at `/api/clinical-documents/[id]/pdf`. **Enviar WhatsApp** confirms, then POSTs to `/api/clinical-documents/[id]/send-whatsapp`.

- [ ] **Step 11: PatientDocumentsTab component**

List of issued docs sorted desc by `issuedAt`. Row click opens `<DocumentPreview>` in a modal with `<DeliveryActions>` reused for re-print/re-send.

> **Note:** the actual mounting of `<PatientDocumentsTab>` as a tab on the patient detail page happens in Group 3 (alongside `patient-tabs.tsx`).

- [ ] **Step 12: Tests**

Unit tests for the issue path (mock DB), placeholder integration. PDF route is integration territory — Phase 4 fills deeper coverage.

- [ ] **Step 13: Commit**

```bash
git commit -m "feat(documents): backend, authenticated print page, PDF rendering, templates, issuance wizard, and history"
```

---

## Task 2J: Procedure record printable view (authenticated)

**Files:**
- Create: `web/src/app/(platform)/procedimentos/[id]/imprimir/page.tsx`
- Create: `web/src/app/(platform)/procedimentos/[id]/imprimir/print-procedure-page-client.tsx`
- Create: `web/src/components/procedures/print-procedure-content.tsx`

Spec Topic 4 lists this as a consumer of `<ProfessionalSignatureBlock>`. Authenticated print page (under `(platform)`) — NOT a public `/c/` URL.

- [ ] **Step 1: Print page (server component)**

```tsx
import { getAuthContext } from '@/lib/auth'
import { getTenantById } from '@/db/queries/tenants'
import { getProcedureRecordWithDetails } from '@/db/queries/procedures'
import { getSignatureBlock } from '@/lib/professional'
import { ClinicHeader } from '@/components/print/clinic-header'
import { PrintStylesheet } from '@/components/print/print-stylesheet'
import { PrintProcedureContent } from '@/components/procedures/print-procedure-content'
import { notFound } from 'next/navigation'

export default async function PrintProcedurePage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthContext()
  const { id } = await params
  const tenant = await getTenantById(auth.tenantId)
  const procedure = await getProcedureRecordWithDetails(auth.tenantId, id)
  if (!procedure || procedure.status !== 'executed') notFound()
  const signature = await getSignatureBlock(procedure.practitionerId)
  return (
    <>
      <PrintStylesheet />
      <div className="print-document">
        <ClinicHeader tenant={tenant} />
        <PrintProcedureContent procedure={procedure} signature={signature} />
      </div>
    </>
  )
}
```

- [ ] **Step 2: PrintProcedureContent component**

Renders patient info, procedure type + performed date, technique, clinical response, product applications table (drawn from the existing `product_applications` query — check `web/src/db/queries/`), and `<ProfessionalSignatureBlock>` at the bottom only if `signature != null`. Otherwise renders italic "Sem assinatura registrada".

- [ ] **Step 3: "Imprimir" button** — added in Task 3 (wiring). Do not modify `procedure-page-client.tsx` here.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(procedures): authenticated printable view for executed procedure records"
```

---

# Group 3 — Cross-cutting wiring (1 serial task)

This group depends on Group 2. Modifies a handful of files that several Group 2 tasks need touched, centralized to avoid conflicts.

## Task 3: Wire features into existing surfaces

**Files modified:**
- `web/src/app/(platform)/dashboard/dashboard-page-client.tsx` (add `<UpcomingBirthdaysCard>` and `<OpenPlanejamentosCard>`)
- `web/src/components/patients/patient-tabs.tsx` (add `pacotes` and `documentos` to the `TABS` array and `PatientTabKey` union)
- `web/src/components/patients/patient-detail-content.tsx` (extend `VALID_TABS` and the render switch to include `pacotes` and `documentos`)
- `web/src/app/(platform)/configuracoes/settings-page-client.tsx` (add Pacotes and Documentos menu items; ensure Perfil exists)
- `web/src/components/patients/patient-header.tsx` or wherever the patient action bar lives (add "Vender pacote" and "Novo documento" buttons)
- `web/src/components/whatsapp/template-picker.tsx` (add `birthday` kind support — small change to the kind filter)
- `web/src/app/(platform)/pacientes/[id]/procedimentos/[procedureId]/procedure-page-client.tsx` (add "Imprimir" button when `procedure.status === 'executed'`; add "Pacote X · sessão Y/N" badge when `patientPackageId` is set)
- `web/src/components/procedures/procedure-form.tsx` (mount `<FollowupTimeline>` / followup actions for `status='planned'` records — this is the child component that actually renders for planned status, per `procedure-page-client.tsx:129`)
- `web/src/components/procedures/procedure-detail-view.tsx` (mount `<FollowupTimeline>` for `status='approved'` records — per `procedure-page-client.tsx:113`)

- [ ] **Step 1: Dashboard wiring**

Open `dashboard-page-client.tsx`. After the existing `<TodayAppointments>` / `<FinancialSummary>` grid, add `<UpcomingBirthdaysCard />` and `<OpenPlanejamentosCard />` (one row, two columns matching the existing layout).

- [ ] **Step 2: Patient detail tabs (two files)**

Add the new tabs in BOTH places. `patient-tabs.tsx` declares the tab buttons and the `PatientTabKey` union; `patient-detail-content.tsx` declares `VALID_TABS` (which gates `?tab=` query params) and the render switch.

```ts
// web/src/components/patients/patient-tabs.tsx
export type PatientTabKey = '...existing tabs...' | 'pacotes' | 'documentos'

const TABS: Array<{ key: PatientTabKey; label: string }> = [
  // ...existing entries...
  { key: 'pacotes', label: 'Pacotes' },
  { key: 'documentos', label: 'Documentos' },
]
```

```ts
// web/src/components/patients/patient-detail-content.tsx
const VALID_TABS: PatientTabKey[] = [
  // ...existing...
  'pacotes',
  'documentos',
]

// in the render switch:
{activeTab === 'pacotes' && <PatientPackagesTab patientId={patient.id} />}
{activeTab === 'documentos' && <PatientDocumentsTab patientId={patient.id} />}
```

- [ ] **Step 3: Patient header actions**

Add two buttons next to existing patient actions:
- "Vender pacote" → opens `<SellPackageDialog>` from Task 2D
- "Novo documento" → opens `<IssueDocumentDialog>` from Task 2H

- [ ] **Step 4: Configurações menu**

In `settings-page-client.tsx`, append menu items:
- "Pacotes" → `/configuracoes/pacotes`
- "Documentos" → `/configuracoes/documentos`
- "Perfil" (if not present) → `/configuracoes/perfil`

- [ ] **Step 5: WhatsApp template-picker birthday kind**

Add `birthday` to the kind enum used by the picker. Add a built-in seed template entry (e.g., "Feliz aniversário 🎂 padrão") so tenants have something to start from. Check `web/src/lib/whatsapp-blueprints.ts` for the seed pattern.

- [ ] **Step 6: Procedure page wiring (three files)**

The routing page `procedure-page-client.tsx` branches by status to different child components. Don't try to render the followup section there — render it in the child that actually shows for `planned`/`approved`. Reference: `web/src/app/(platform)/pacientes/[id]/procedimentos/[procedureId]/procedure-page-client.tsx:55-139`.

1. In **`procedure-page-client.tsx`** itself:
   - When `procedure.status === 'executed'`, add an "Imprimir" button next to the existing actions; opens `/procedimentos/[id]/imprimir` (the authenticated route from Task 2J).
   - When `procedure.patientPackageId` is set (any status), render a small badge: `Pacote: <name> · sessão <consumedOrdinal>/<total>`. Fetch via `usePatientPackages(patientId)`.

2. In **`procedure-form.tsx`** (rendered for `status='planned'` and `status='draft'`): add an "Acompanhamento" panel below the form with `<FollowupTimeline procedureRecordId={id}>` and the two action buttons (record followup, snooze). Use the existing modals from Task 2E (`FollowupModal`, `SnoozeModal`).

3. In **`procedure-detail-view.tsx`** (rendered for `status='approved'`): mount the same `<FollowupTimeline>` + action buttons in an "Acompanhamento" section. Identical wiring to #2.

> The previous draft of this plan also proposed using the saved practitioner signature inside `service-contract-section.tsx`. That step was **removed** after review — the existing `service-contract-section.tsx` captures the **patient's** acceptance signature, not the practitioner's. Replacing it would corrupt the legal audit trail. If a practitioner signature block is needed on the printable contract, add it as a separate visible block in a follow-up — do NOT touch the patient signature flow.

- [ ] **Step 7: Smoke tests**

```bash
pnpm --filter @floraclin/web typecheck
pnpm --filter @floraclin/web lint
pnpm --filter @floraclin/web test:run
```

All must pass.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(clinic-pack): wire dashboard widgets, patient tabs, settings menu, followup sections"
```

---

# Out of plan (deferred to follow-ups)

- ICP-Brasil / Memed integration for signed prescriptions (planned as future `deliveredVia` value).
- Automated WhatsApp follow-up drip campaigns (followup data already captured).
- Cross-package revenue reporting (planned for a future financial report).
- Optional cron-based package expiration (lazy-on-read is the MVP; cron only if performance demands).

---

# Self-review checklist (before handoff to Phase 2)

- [ ] Every spec section has at least one task implementing it.
- [ ] Within each Group, no two tasks list the same file under Create or Modify.
- [ ] All Group 2 dependencies on Group 1 are satisfied (signature block, photo schema, package schema, followup schema, etc.).
- [ ] No "TODO" / "TBD" / vague language in tasks.
- [ ] Migration numbering (0012) does not collide with `web/src/db/migrations/`.
