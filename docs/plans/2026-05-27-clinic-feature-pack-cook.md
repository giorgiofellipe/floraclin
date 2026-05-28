# Clinic feature pack — implementation plan (cook)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Cook execution:** tasks are organized into parallelization Groups — within a group, tasks have disjoint file ownership and run in parallel agents simultaneously.

**Goal:** Ship the six client-requested features from `docs/superpowers/specs/2026-05-27-clinic-feature-pack-design.md` — birthday reminder, photo cropping, procedure packages, professional signature, prescriptions/atestados, and open planejamentos follow-up.

**Architecture:** Single Drizzle migration adds all new tables/columns up front (Group 0). Topic backends and reusable components land in parallel (Group 1). Topic UIs and the document-system full stack land in parallel (Group 2). Cross-cutting wiring (dashboard widgets, patient-detail tabs, configurações menu, WhatsApp template kinds) lands serially at the end (Group 3) to avoid file-ownership conflicts.

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

# Group 0 — Schema and migration (sequential, 1 task)

This whole group is one task because every later task reads `schema.ts` and the generated migration file. Splitting would force merge conflicts.

## Task 0: All DB schema changes + migration

**Files:**
- Modify: `web/src/db/schema.ts`
- Create: `web/src/db/migrations/0012_clinic_feature_pack.sql` (filename will be drizzle-generated — accept whatever drizzle picks; only the number must be 0012)
- Create: `web/src/db/migrations/meta/0012_snapshot.json` (drizzle-generated)
- Modify: `web/src/db/migrations/meta/_journal.json` (drizzle-generated)

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

Expected: produces `0012_clinic_feature_pack.sql` and `0012_snapshot.json`, updates `_journal.json`.

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
git add web/src/db/schema.ts web/src/db/migrations/0012_clinic_feature_pack.sql web/src/db/migrations/meta/
git commit -m "feat(db): add clinic feature pack schema (birthdays, packages, signature, documents, followups)"
```

---

# Group 1 — Backend foundations (6 parallel tasks)

All Group 1 tasks depend on Group 0 (schema must exist). They are file-disjoint from each other.

## Task 1A: Professional signature server + profile API

**Files:**
- Create: `web/src/lib/professional.ts`
- Create: `web/src/lib/__tests__/professional.test.ts`
- Modify: `web/src/app/api/profile/route.ts` (add signature/registry to update payload)
- Modify: `web/src/validations/` — add a new file `web/src/validations/professional.ts`

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

- [ ] **Step 3: Extend `app/api/profile/route.ts` PATCH to accept these fields**

Read the existing PATCH handler. Merge `professionalProfileSchema` into the body validator. When `signatureData` is updated, also set `signatureUpdatedAt = new Date()`. Permission: a user can only update their own row (this is already the case — the route uses the session userId).

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
    ageTurning: args.currentYear - new Date(r.birthDate! + 'T12:00:00').getFullYear(),
    greetedByName: null, // populated in a join enrichment if needed
  }))
}
```

- [ ] **Step 2: Range builders in `lib/birthdays.ts`**

```ts
import { brToday } from '@/lib/dates'
import { addDays, parseISO } from 'date-fns'

export function birthdayMonthDayPairs(args: { from: string; to: string }): Array<{ month: number; day: number }> {
  const pairs: Array<{ month: number; day: number }> = []
  let cursor = parseISO(args.from + 'T12:00:00')
  const end = parseISO(args.to + 'T12:00:00')
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
  const today = brToday()
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

```ts
import { db } from '@/db/client'
import { patientPackages, patientPackageLines, financialEntries, installments } from '@/db/schema'
import { sql } from 'drizzle-orm'
import { brToday, parseBrDate, toLocalYmd } from '@/lib/dates'
import { addMonths, addDays } from 'date-fns'

export async function sellPackage(args: {
  tenantId: string
  soldBy: string
  input: SellPackageInput // from validation
}): Promise<{ packageId: string; financialEntryId: string }> {
  return db.transaction(async (tx) => {
    // 1. Create financial entry
    const [entry] = await tx.insert(financialEntries).values({
      tenantId: args.tenantId,
      patientId: args.input.patientId,
      description: args.input.name,
      totalAmount: String(args.input.totalAmount),
      installmentCount: args.input.installmentCount,
      status: 'pending',
      createdBy: args.soldBy,
    }).returning()

    // 2. Create installments (mirror the existing financial entry creation pattern)
    const baseDate = parseBrDate(brToday(), '12:00:00')
    const per = args.input.totalAmount / args.input.installmentCount
    for (let i = 0; i < args.input.installmentCount; i++) {
      await tx.insert(installments).values({
        tenantId: args.tenantId,
        financialEntryId: entry.id,
        installmentNumber: i + 1,
        amount: String(per.toFixed(2)),
        dueDate: toLocalYmd(addMonths(baseDate, i)),
        status: 'pending',
        paymentMethod: args.input.paymentMethod,
      })
    }

    // 3. Compute expiresAt
    const expiresAt = args.input.validityMonths
      ? toLocalYmd(addMonths(parseBrDate(brToday(), '12:00:00'), args.input.validityMonths))
      : null

    // 4. Create patient_packages row
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

    // 5. Create patient_package_lines
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

- [ ] **Step 3: Session starter — `startPackageSession`**

```ts
export async function startPackageSession(args: {
  tenantId: string
  practitionerId: string
  patientPackageId: string
  patientPackageLineId: string
}): Promise<{ procedureRecordId: string }> {
  return db.transaction(async (tx) => {
    // Verify package + line exist, belong to tenant, package is active (or expired with explicit override flag — not handled here)
    const [pkg] = await tx.select().from(patientPackages).where(eq(patientPackages.id, args.patientPackageId))
    if (!pkg || pkg.tenantId !== args.tenantId) throw new Error('Package not found')
    if (pkg.status === 'cancelled') throw new Error('Package is cancelled')

    const [line] = await tx.select().from(patientPackageLines).where(eq(patientPackageLines.id, args.patientPackageLineId))
    if (!line || line.patientPackageId !== pkg.id) throw new Error('Line not found')

    // Check sessions remaining
    const consumedRows = await tx.select({ count: sql<number>`count(*)::int` })
      .from(procedureRecords)
      .where(and(
        eq(procedureRecords.patientPackageLineId, line.id),
        eq(procedureRecords.status, 'executed'),
      ))
    if ((consumedRows[0]?.count ?? 0) >= line.sessionsTotal) {
      throw new Error('Line fully consumed')
    }

    // Create draft procedure record
    const [record] = await tx.insert(procedureRecords).values({
      tenantId: args.tenantId,
      patientId: pkg.patientId,
      practitionerId: args.practitionerId,
      procedureTypeId: line.procedureTypeId,
      patientPackageId: pkg.id,
      patientPackageLineId: line.id,
      status: 'draft',
    }).returning()

    return { procedureRecordId: record.id }
  })
}
```

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

# Group 2 — Topic UIs + Topic 5 full stack (9 parallel tasks)

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
- Modify: `web/src/components/patients/patient-photos-tab.tsx`
- Modify: `web/src/components/photos/photo-comparison.tsx`
- Modify: `web/src/components/procedures/execution/execution-photo-section.tsx`
- Add dependency: `react-image-crop` via `pnpm --filter @floraclin/web add react-image-crop`

- [ ] **Step 1: Install `react-image-crop`**

```bash
pnpm --filter @floraclin/web add react-image-crop
```

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

- [ ] **Step 5: Integrate into patient-photos-tab.tsx**

Add a "Recortar" overflow action on each photo card. Opens cropper modal with existing src + currentCrop. On save, call `useUpdatePhotoCrop`. On view, render the photo via `applyCrop` helper (from Task 1F).

- [ ] **Step 6: Integrate into photo-comparison.tsx**

Add a "Recortar" button on each side. Same modal flow.

- [ ] **Step 7: Update execution-photo-section.tsx similarly**

Same pattern as `patient-photos-tab.tsx`.

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

## Task 2F: Clinical documents backend

**Files:**
- Create: `web/src/lib/clinical-documents.ts` (template rendering, snapshot creation, send-whatsapp orchestration)
- Create: `web/src/lib/__tests__/clinical-documents.test.ts`
- Create: `web/src/lib/pdf.ts` (HTML→PDF via headless Chromium)
- Create: `web/src/db/queries/clinical-documents.ts`
- Create: `web/src/validations/clinical-document.ts`
- Create: `web/src/app/api/document-templates/route.ts` (GET, POST)
- Create: `web/src/app/api/document-templates/[id]/route.ts` (PATCH, DELETE)
- Create: `web/src/app/api/clinical-documents/route.ts` (POST — issue)
- Create: `web/src/app/api/clinical-documents/[id]/pdf/route.ts` (GET — stream PDF)
- Create: `web/src/app/api/clinical-documents/[id]/send-whatsapp/route.ts` (POST)
- Create: `web/src/app/api/patients/[id]/documents/route.ts` (GET — history)
- Add dependencies: `@sparticuz/chromium-min`, `puppeteer-core` via `pnpm --filter @floraclin/web add`

- [ ] **Step 1: Install PDF deps**

```bash
pnpm --filter @floraclin/web add @sparticuz/chromium-min puppeteer-core
```

- [ ] **Step 2: Generic placeholder renderer**

```ts
// web/src/lib/clinical-documents.ts
export interface DocumentRenderContext {
  patient: { name: string; cpf: string | null; birthDate: string | null }
  practitioner: { name: string; registry: string }
  tenant: { name: string }
  date: Date
}

const FORMATTERS = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })

export function renderDocumentBody(body: string, ctx: DocumentRenderContext): string {
  const dateShort = ctx.date.toLocaleDateString('pt-BR')
  const dateLong = FORMATTERS.format(ctx.date)
  const map: Record<string, string> = {
    '{{patient.name}}': ctx.patient.name,
    '{{patient.cpf}}': ctx.patient.cpf ?? '',
    '{{patient.birthDate}}': ctx.patient.birthDate ?? '',
    '{{date}}': dateShort,
    '{{date.long}}': `${ctx.tenant.name.split(' - ').pop() || 'São Paulo'}, ${dateLong}`, // simplification — city from tenant
    '{{practitioner.name}}': ctx.practitioner.name,
    '{{practitioner.registry}}': ctx.practitioner.registry,
    '{{tenant.name}}': ctx.tenant.name,
  }
  let out = body
  for (const [k, v] of Object.entries(map)) out = out.replaceAll(k, v)
  return out
}

export const AVAILABLE_PLACEHOLDERS: Array<{ token: string; description: string }> = [
  { token: '{{patient.name}}', description: 'Nome do paciente' },
  { token: '{{patient.cpf}}', description: 'CPF' },
  { token: '{{patient.birthDate}}', description: 'Data de nascimento' },
  { token: '{{date}}', description: 'Data atual (DD/MM/AAAA)' },
  { token: '{{date.long}}', description: 'Data por extenso' },
  { token: '{{practitioner.name}}', description: 'Nome do profissional' },
  { token: '{{practitioner.registry}}', description: 'Registro profissional (ex: CRM-SP 12345)' },
  { token: '{{tenant.name}}', description: 'Nome da clínica' },
]
```

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

- [ ] **Step 4: PDF generation in `lib/pdf.ts`**

```ts
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium-min'

const CHROMIUM_URL = 'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar' // pin to current latest

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(CHROMIUM_URL),
    headless: true,
  })
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' } })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}
```

> **Implementer note:** verify the chromium pack URL against the current `@sparticuz/chromium-min` README — pin to the matching major. This is the most likely deployment failure point; test against the real Vercel build pipeline early.

- [ ] **Step 5: PDF route**

```ts
// app/api/clinical-documents/[id]/pdf/route.ts
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const session = await requireTenant()
  const doc = await getClinicalDocument(session.tenantId, id) // implemented in db/queries/clinical-documents.ts
  if (!doc) return new NextResponse('Not found', { status: 404 })

  // Render the print page to HTML via fetch to /imprimir URL (created in Task 2I)
  const url = new URL(`/c/${session.tenantSlug}/documentos/${id}/imprimir`, req.url)
  const html = await fetch(url, { headers: { cookie: req.headers.get('cookie') ?? '' } }).then((r) => r.text())

  const pdf = await renderHtmlToPdf(html)
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${doc.kind}-${id}.pdf"`,
    },
  })
}
```

- [ ] **Step 6: send-whatsapp route**

Renders PDF, uploads to storage (use existing storage helper in `lib/storage.ts`), sends as a document message via the existing WhatsApp send pipeline. Update doc with `whatsappMessageId` and `deliveredVia`.

- [ ] **Step 7: Tests**

Unit tests for `renderDocumentBody` (table-driven). The PDF route is integration territory — leave deep tests for Phase 4.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(documents): backend, PDF rendering, and WhatsApp delivery"
```

---

## Task 2G: Document templates settings page

**Files:**
- Create: `web/src/app/(platform)/configuracoes/documentos/page.tsx`
- Create: `web/src/app/(platform)/configuracoes/documentos/documentos-page-client.tsx`
- Create: `web/src/components/settings/document-template-form.tsx`
- Create: `web/src/components/settings/document-template-list.tsx`
- Create: `web/src/hooks/queries/use-document-templates.ts`

- [ ] **Step 1: Hooks**

`useDocumentTemplates(kind)`, `useCreateDocumentTemplate`, `useUpdateDocumentTemplate`, `useArchiveDocumentTemplate`.

- [ ] **Step 2: Page UI**

Tabs: Receitas | Atestados. Within each tab, a list and a "Novo modelo" button. Form is a Sheet/Dialog with name + body textarea + a sidebar listing `AVAILABLE_PLACEHOLDERS` (each clickable to insert at cursor). Mirror the existing WhatsApp template management screen (`grep -rln "template" web/src/components/settings/`).

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(documents): templates settings page for receitas and atestados"
```

---

## Task 2H: Document issuance UI + history tab component

**Files:**
- Create: `web/src/components/clinical-documents/issue-document-dialog.tsx`
- Create: `web/src/components/clinical-documents/document-preview.tsx`
- Create: `web/src/components/clinical-documents/patient-documents-tab.tsx`
- Create: `web/src/components/clinical-documents/delivery-actions.tsx`
- Create: `web/src/hooks/queries/use-clinical-documents.ts`

- [ ] **Step 1: Hooks**

`usePatientClinicalDocuments(patientId)`, `useIssueClinicalDocument`, `useSendDocumentWhatsapp`, `useDownloadDocumentPdf`.

- [ ] **Step 2: IssueDocumentDialog**

Wizard:
- Step 1: Kind selector (Receita / Atestado).
- Step 2: Template picker (optional) + title input + body textarea. Body field shows the resolved preview on the right (`<DocumentPreview>`).
- Step 3 (after submit): `<DeliveryActions documentId={id}>` — Imprimir, Baixar PDF, Enviar WhatsApp.

Guard at the start: if practitioner lacks signature/registry (call `useProfile()` to check), block with a CTA pointing to `/configuracoes/perfil`.

- [ ] **Step 3: DocumentPreview**

Renders `<ClinicHeader>` (create if not present — read clinic info from `useTenant`), patient info, body, date, `<ProfessionalSignatureBlock>`. Same component used by the print page.

- [ ] **Step 4: DeliveryActions**

Three buttons. Print opens new window to `/c/[slug]/documentos/[id]/imprimir`. PDF download triggers a hidden anchor with the API URL. WhatsApp action shows a confirmation, then `useSendDocumentWhatsapp`.

- [ ] **Step 5: PatientDocumentsTab**

List of issued docs sorted desc by `issuedAt`. Each row: title, kind chip, date, delivered-via badge. Row click opens `<DocumentPreview>` in a modal with `<DeliveryActions>` reused.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(documents): issuance wizard, preview, delivery actions, and history tab"
```

---

## Task 2I: Print page route + ClinicHeader

**Files:**
- Create: `web/src/app/c/[tenantSlug]/documentos/[id]/imprimir/page.tsx`
- Create: `web/src/app/c/[tenantSlug]/documentos/[id]/imprimir/print-document-client.tsx`
- Create: `web/src/components/clinical-documents/clinic-header.tsx`

- [ ] **Step 1: Print page (server component)**

```tsx
import { getClinicalDocument } from '@/db/queries/clinical-documents'
import { getTenantBySlug } from '@/db/queries/tenants'
import { notFound } from 'next/navigation'
import { PrintDocumentClient } from './print-document-client'

export default async function PrintDocumentPage({
  params,
}: { params: Promise<{ tenantSlug: string; id: string }> }) {
  const { tenantSlug, id } = await params
  const tenant = await getTenantBySlug(tenantSlug)
  if (!tenant) notFound()
  const doc = await getClinicalDocument(tenant.id, id)
  if (!doc) notFound()
  return <PrintDocumentClient tenant={tenant} doc={doc} />
}
```

- [ ] **Step 2: Print client component**

Renders `<ClinicHeader>`, patient line, `body`, date, `<ProfessionalSignatureBlock signatureDataUrl={doc.professionalSnapshot.signatureDataUrl} displayName={doc.professionalSnapshot.name} registryLine={doc.professionalSnapshot.registryLine} />`.

Print stylesheet:
```tsx
<style jsx global>{`
  @media print {
    body { background: white; }
    @page { size: A4; margin: 20mm; }
  }
  body { font-family: 'Times New Roman', Times, serif; }
`}</style>
```

- [ ] **Step 3: ClinicHeader**

Renders tenant logo + name + address + phone from `tenant` row.

- [ ] **Step 4: Auth model**

Print pages are tenant-scoped (URL contains slug) and **public** (no session cookie needed) — but the `id` is a UUID effectively unguessable. This matches the use-pattern (the practitioner needs to print without logging in on the device). If the user wants stricter auth, gate with a short-lived signed token (out of scope for MVP).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(documents): public print page with clinic header"
```

---

## Task 2J: Procedure record printable view

**Files:**
- Create: `web/src/app/c/[tenantSlug]/procedimentos/[id]/imprimir/page.tsx`
- Create: `web/src/app/c/[tenantSlug]/procedimentos/[id]/imprimir/print-procedure-client.tsx`
- Create: `web/src/components/procedures/print-procedure-content.tsx`

Spec Topic 4 lists this as a consumer of `<ProfessionalSignatureBlock>`. Same model as Task 2I's print page, applied to executed procedure records.

- [ ] **Step 1: Print page (server component)**

```tsx
import { getProcedureRecordWithDetails } from '@/db/queries/procedures'
import { getTenantBySlug } from '@/db/queries/tenants'
import { getSignatureBlock } from '@/lib/professional'
import { notFound } from 'next/navigation'
import { PrintProcedureClient } from './print-procedure-client'

export default async function PrintProcedurePage({
  params,
}: { params: Promise<{ tenantSlug: string; id: string }> }) {
  const { tenantSlug, id } = await params
  const tenant = await getTenantBySlug(tenantSlug)
  if (!tenant) notFound()
  const procedure = await getProcedureRecordWithDetails(tenant.id, id)
  if (!procedure || procedure.status !== 'executed') notFound()
  const signature = await getSignatureBlock(procedure.practitionerId)
  return <PrintProcedureClient tenant={tenant} procedure={procedure} signature={signature} />
}
```

- [ ] **Step 2: PrintProcedureContent component**

Renders `<ClinicHeader>` (reused from Task 2I), patient info, procedure type + performed date, technique, clinical response, product applications table (drawn from existing `productApplications` query), and `<ProfessionalSignatureBlock>` at the bottom (only if `signature != null`; otherwise show italic "Sem assinatura registrada").

Use the same `@media print` stylesheet pattern as Task 2I.

- [ ] **Step 3: "Imprimir" button**

In Task 3 (wiring) we'll add the button to the executed procedure record page. Do **not** add it here — Task 3 owns `procedure-page-client.tsx`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(procedures): printable view for executed procedure records"
```

---

# Group 3 — Cross-cutting wiring (1 serial task)

This group depends on Group 2. Modifies a handful of files that several Group 2 tasks need touched, centralized to avoid conflicts.

## Task 3: Wire features into existing surfaces

**Files modified:**
- `web/src/app/(platform)/dashboard/dashboard-page-client.tsx` (add `<UpcomingBirthdaysCard>` and `<OpenPlanejamentosCard>`)
- `web/src/components/patients/patient-detail-content.tsx` (add Pacotes and Documentos tabs)
- `web/src/app/(platform)/configuracoes/settings-page-client.tsx` (add Pacotes and Documentos menu items; ensure Perfil exists)
- `web/src/components/patients/patient-header.tsx` or wherever the patient action bar lives (add "Vender pacote" and "Novo documento" buttons)
- `web/src/components/whatsapp/template-picker.tsx` (add `birthday` kind support — small change to the kind filter)
- `web/src/components/procedures/procedure-page-client.tsx` (mount `<FollowupTimeline>` in an "Acompanhamento" section for planned/approved procedures; add a "Pacote X · sessão Y/N" badge when `patientPackageId` is set; add "Imprimir" button on executed records)
- `web/src/components/procedures/approval/service-contract-section.tsx` (use saved practitioner signature when present, fall back to live signing)

- [ ] **Step 1: Dashboard wiring**

Open `dashboard-page-client.tsx`. After the existing `<TodayAppointments>` / `<FinancialSummary>` grid, add `<UpcomingBirthdaysCard />` and `<OpenPlanejamentosCard />` (one row, two columns matching the existing layout).

- [ ] **Step 2: Patient detail tabs**

Find the tabs registration in `patient-detail-content.tsx`. Add:
- `pacotes` → `<PatientPackagesTab patientId={patient.id} />` (from Task 2D)
- `documentos` → `<PatientDocumentsTab patientId={patient.id} />` (from Task 2H)

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

- [ ] **Step 6: Procedure page followup section + package badge + print button**

In `procedure-page-client.tsx`:
1. When `procedure.status IN ('planned', 'approved')`, render a new "Acompanhamento" section with `<FollowupTimeline>` (from Task 2E) and the same action buttons (record followup, snooze).
2. When `procedure.patientPackageId` is set, render a small badge: `Pacote: <name> · sessão <consumed+1>/<total>`. Fetch package info via `usePatientPackages`.
3. When `procedure.status === 'executed'`, add an "Imprimir" button that opens `/c/[tenantSlug]/procedimentos/[id]/imprimir` (from Task 2J).

- [ ] **Step 7: Service-contract signature reuse**

In `service-contract-section.tsx`, change the practitioner signature flow:
1. On mount, query `useProfile()` for the current user's signature.
2. If `signatureData` is set, render `<ProfessionalSignatureBlock>` (preview) instead of asking the practitioner to sign live.
3. Add a small "Assinar agora" link to fall back to the live `<SignaturePad>` when the user wants to override.
4. On submit, send either the saved signature or the live one to the existing consent acceptance endpoint.

- [ ] **Step 8: Smoke tests**

```bash
pnpm --filter @floraclin/web typecheck
pnpm --filter @floraclin/web lint
pnpm --filter @floraclin/web test:run
```

All must pass.

- [ ] **Step 9: Commit**

```bash
git commit -m "feat(clinic-pack): wire dashboard widgets, patient tabs, settings menu, and signature reuse"
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
