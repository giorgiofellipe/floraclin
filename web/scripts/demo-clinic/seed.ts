/**
 * Seeds the Clínica Lumé demo tenant.
 *
 * This script is run BY A HUMAN, AGAINST PRODUCTION. It is written to be
 * boring and predictable rather than clever:
 *
 * - `--dry-run` is the flag to reach for first. It plans everything, prints
 *   the counts and totals, and writes nothing at all.
 * - It refuses to run without `DATABASE_URL`.
 * - It refuses to run if the tenant already exists. Teardown is out of scope
 *   (the operator has accepted that this data stays), so the only safe
 *   idempotency story is "never write twice". There is no upsert path here
 *   and no way to end up with duplicates.
 * - Every write happens inside ONE transaction. A failure anywhere leaves
 *   the database exactly as it was found.
 * - Nothing goes through the app's API or any service layer, so no
 *   automation, WhatsApp send or email can fire as a side effect. The tenant
 *   is created with `SAFETY_SETTINGS`, which is what excludes it from the
 *   daily WhatsApp automations cron; `verify.ts` asserts that exclusion
 *   before and after.
 *
 * All content comes from the pure generators in `web/src/lib/demo-seed/`,
 * which are unit-tested. This file only resolves that planned data into rows.
 *
 * ─── Write order ───────────────────────────────────────────────────────
 *
 * tenant -> users + tenant_users -> tenant_subscriptions -> expense_categories
 * -> procedure_types -> patients -> appointments -> procedure_records
 * -> product_applications -> financial_entries + installments -> expenses +
 * expense_installments -> cash_movements -> anamneses -> face_diagrams +
 * diagram_points -> prospects + prospect_activities -> whatsapp_conversations +
 * whatsapp_messages -> photo_assets + photo_annotations
 *
 * `product_applications` is written for EVERY past procedure record (all of
 * history + current month), not just the `FEATURED_PATIENT_COUNT` patients
 * that get a rendered face diagram: a lot-level traceability log exists
 * independently of whether the diagram was drawn, and the "Procedimentos
 * realizados" report expects one for every performed procedure. Non-
 * injectable procedures still contribute zero rows, same as
 * `buildFaceDiagramPoints`.
 *
 * This deviates from the plan's listing in one place, deliberately.
 * `procedure_records.appointment_id` must point at the appointment the record
 * came from, and `financial_entries` reference both, so appointments have to
 * be written before procedure records, and both before the financial rows.
 * Appointments are therefore written in a single step covering the past
 * (history and current-month procedures, status 'completed'), today, and the
 * forward window, instead of only "today + forward".
 *
 * ─── Back-dating, the part that is easy to get wrong ───────────────────
 *
 * `getRevenueOverview` filters its SUMMARY on `financial_entries.created_at`
 * but groups its CHART on `installments.paid_at`. Both are back-dated here.
 * Getting only one right produces a screen that is half correct, which is
 * worse than one that is obviously broken. `expense_installments` carries no
 * `tenant_id` and the overview filters `expenses.created_at`, so the expense
 * parent is back-dated per month too, not just its installment.
 *
 * `cash_movements` is an append-only ledger the app writes only when a
 * payment goes through `recordPayment` / `payExpenseInstallment` (see
 * `web/src/db/queries/financial.ts` and `web/src/db/queries/expenses.ts`).
 * Seeded installments and expenses are inserted already marked `paid`,
 * bypassing that path entirely, so this file writes the matching
 * `cash_movements` row itself for every paid installment (inflow) and every
 * paid expense installment (outflow), each dated to that row's own `paidAt`
 * -- same shape the app produces, just written directly instead of through
 * the service function. Without this, `listCashMovements` / `getLedgerSummary`
 * / `exportLedgerCSV` (the "Extrato por período" report and the Financeiro
 * ledger) render empty even though the financial totals above are correct.
 *
 * Every date goes through `@/lib/dates`. There is no bare
 * `new Date('YYYY-MM-DD')` and no `.toISOString().split('T')[0]` in this file:
 * a `YYYY-MM-DD` here is always a BR calendar day, anchored with
 * `parseBrDate` before it becomes an instant.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import bcrypt from 'bcryptjs'
import { asc, desc, eq, or } from 'drizzle-orm'

import { db } from '@/db/client'
import {
  anamneses,
  appointments,
  cashMovements,
  diagramPoints,
  expenseCategories,
  expenseInstallments,
  expenses,
  faceDiagrams,
  financialEntries,
  installments,
  patients,
  photoAnnotations,
  photoAssets,
  plans,
  procedureRecords,
  procedureTypes,
  productApplications,
  prospectActivities,
  prospects,
  tenantSubscriptions,
  tenantUsers,
  tenants,
  users,
  whatsappConversations,
  whatsappMessages,
} from '@/db/schema'
import { brToday, parseBrDate } from '@/lib/dates'
import { getStoragePath } from '@/lib/storage'
import {
  CATALOGUE,
  CLINIC,
  DEMO_SLUG,
  DEMO_TENANT_ID,
  MONTHLY_EXPENSES,
  PATIENT_COUNT,
  PRACTITIONER,
  SAFETY_SETTINGS,
  SIX_MONTH_RECEIVED,
  TARGETS,
} from '@/lib/demo-seed/config'
import { buildPatients } from '@/lib/demo-seed/identity'
import { buildCurrentMonth, buildHistory } from '@/lib/demo-seed/revenue'
import { buildForwardSlots, buildTodaySlots, type PlannedAppointment } from '@/lib/demo-seed/schedule'
import {
  FEATURED_PATIENT_COUNT,
  buildAnamnesis,
  buildFaceDiagramPoints,
  buildProcedureNotes,
  buildProductApplications,
} from '@/lib/demo-seed/clinical'
import {
  buildConversations,
  buildPhotoPairs,
  buildProspects,
  type DemoPhotoPair,
  type DemoProspect,
  type DemoWhatsappConversation,
} from '@/lib/demo-seed/engagement'
import type { PlannedEntry, SeededPatient } from '@/lib/demo-seed/types'
import { runSafetyAssertions, runTargetAssertions } from './verify'

/** The transaction handle drizzle hands to the `db.transaction` callback. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Chunk size for multi-row inserts, well under Postgres's parameter cap. */
const INSERT_CHUNK = 400

async function inChunks<T>(rows: T[], fn: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await fn(rows.slice(i, i + INSERT_CHUNK))
  }
}

// ─── Calendar helpers (pure string arithmetic, no host-TZ dependence) ────

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function ymdParts(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split('-').map(Number)
  return { year, month, day }
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return days[month - 1]
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = month - 1 + delta
  return {
    year: year + Math.floor(zeroBased / 12),
    month: (((zeroBased % 12) + 12) % 12) + 1,
  }
}

function addDaysYmd(day: string, delta: number): string {
  let { year, month, day: d } = ymdParts(day)
  d += delta
  while (d > daysInMonth(year, month)) {
    d -= daysInMonth(year, month)
    ;({ year, month } = shiftMonth(year, month, 1))
  }
  while (d < 1) {
    ;({ year, month } = shiftMonth(year, month, -1))
    d += daysInMonth(year, month)
  }
  return ymd(year, month, d)
}

function minutesToHHMM(totalMinutes: number): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`
}

/** `HH:MM` -> the instant at that BR wall-clock time on `day`. */
function brInstant(day: string, hhmm: string): Date {
  return parseBrDate(day, `${hhmm}:00`)
}

function money(value: number): string {
  return value.toFixed(2)
}

// ─── Planning (pure, runs identically in dry-run and real mode) ──────────

interface PlannedExpense {
  description: string
  category: string
  amount: number
  /** BR calendar day the expense was recorded and paid. */
  date: string
}

interface SeedPlan {
  todayYmd: string
  patients: SeededPatient[]
  historyEntries: PlannedEntry[]
  currentEntries: PlannedEntry[]
  todaySlots: PlannedAppointment[]
  forwardSlots: PlannedAppointment[]
  expenses: PlannedExpense[]
  prospects: DemoProspect[]
  conversations: DemoWhatsappConversation[]
  photoPairs: DemoPhotoPair[]
}

/**
 * One set of `MONTHLY_EXPENSES` per month of the six-month window, recorded
 * (and paid) on the 5th. The current month uses the 5th or today, whichever
 * comes first, so an expense is never recorded in the future.
 */
function planExpenses(todayYmd: string): PlannedExpense[] {
  const { year, month, day } = ymdParts(todayYmd)
  const planned: PlannedExpense[] = []

  for (let monthsBack = SIX_MONTH_RECEIVED.length - 1; monthsBack >= 0; monthsBack--) {
    const shifted = shiftMonth(year, month, -monthsBack)
    const dayOfMonth = monthsBack === 0 ? Math.min(5, day) : 5
    const date = ymd(shifted.year, shifted.month, dayOfMonth)
    for (const expense of MONTHLY_EXPENSES) {
      planned.push({ ...expense, date })
    }
  }

  return planned
}

function buildPlan(): SeedPlan {
  // Anchored to BR noon so every generator sees the same calendar day no
  // matter which timezone the operator's machine runs in.
  const todayYmd = brToday()
  const today = parseBrDate(todayYmd, '12:00:00')

  const seededPatients = buildPatients(PATIENT_COUNT, today)

  return {
    todayYmd,
    patients: seededPatients,
    historyEntries: buildHistory(today, PATIENT_COUNT),
    currentEntries: buildCurrentMonth(today, PATIENT_COUNT),
    todaySlots: buildTodaySlots(today),
    forwardSlots: buildForwardSlots(today),
    expenses: planExpenses(todayYmd),
    prospects: buildProspects(today),
    conversations: buildConversations(seededPatients, today),
    photoPairs: buildPhotoPairs(),
  }
}

// ─── Plan summary ────────────────────────────────────────────────────────

function sumInstallments(entries: PlannedEntry[], status: 'paid' | 'pending'): number {
  return entries.reduce(
    (total, entry) =>
      total + entry.installments.filter((i) => i.status === status).reduce((s, i) => s + i.amount, 0),
    0,
  )
}

function countInstallments(entries: PlannedEntry[]): number {
  return entries.reduce((total, entry) => total + entry.installments.length, 0)
}

/** One `cash_movements` inflow gets written per paid installment. */
function countPaidInstallments(entries: PlannedEntry[]): number {
  return entries.reduce(
    (total, entry) => total + entry.installments.filter((i) => i.status === 'paid').length,
    0,
  )
}

function printTable(title: string, rows: Array<[string, string | number]>): void {
  const width = Math.max(...rows.map(([label]) => label.length))
  console.log(title)
  for (const [label, value] of rows) {
    console.log(`  ${label.padEnd(width)}  ${value}`)
  }
  console.log('')
}

function describePlan(plan: SeedPlan): Array<[string, string | number]> {
  const pastEntries = [...plan.historyEntries, ...plan.currentEntries]
  const diagramPointCount = plan.patients
    .slice(0, FEATURED_PATIENT_COUNT)
    .reduce((total, _, patientIndex) => {
      const entry = findFeaturedEntry(plan.currentEntries, patientIndex)
      return total + (entry ? buildFaceDiagramPoints(entry.procedure.procedureName).length : 0)
    }, 0)
  // Row count only -- content (batch numbers, expiration) doesn't depend on
  // `index`, so 0 is a fine stand-in for the real per-record noteIndex here.
  const productApplicationCount = pastEntries.reduce(
    (total, entry) =>
      total + buildProductApplications(entry.procedure.procedureName, 0, parseBrDate(plan.todayYmd)).length,
    0,
  )

  const currentMonthExpenses = plan.expenses.filter((e) => e.date.startsWith(plan.todayYmd.slice(0, 7)))

  return [
    ['tenants', 1],
    ['users', 1],
    ['tenant_users', 1],
    ['tenant_subscriptions', 1],
    ['expense_categories', new Set(MONTHLY_EXPENSES.map((e) => e.category)).size],
    ['procedure_types', CATALOGUE.length],
    ['patients', plan.patients.length],
    ['appointments (past)', pastEntries.length],
    ['appointments (today)', plan.todaySlots.length],
    ['appointments (forward)', plan.forwardSlots.length],
    ['procedure_records', pastEntries.length],
    ['product_applications', productApplicationCount],
    ['financial_entries', pastEntries.length],
    ['installments', countInstallments(pastEntries)],
    ['expenses', plan.expenses.length],
    ['expense_installments', plan.expenses.length],
    ['cash_movements', countPaidInstallments(pastEntries) + plan.expenses.length],
    ['anamneses', Math.min(FEATURED_PATIENT_COUNT, plan.patients.length)],
    ['face_diagrams', countFeaturedDiagrams(plan)],
    ['diagram_points', diagramPointCount],
    ['prospects', plan.prospects.length],
    ['prospect_activities', plan.prospects.reduce((n, p) => n + p.activities.length, 0)],
    ['whatsapp_conversations', plan.conversations.length],
    ['whatsapp_messages', plan.conversations.reduce((n, c) => n + c.messages.length, 0)],
    ['photo_assets', plan.photoPairs.length * 2],
    ['photo_annotations', plan.photoPairs.length * 2],
    ['-- totals --', ''],
    ['procedures this month', plan.currentEntries.length],
    ['gross this month', money(plan.currentEntries.reduce((n, e) => n + e.totalAmount, 0))],
    ['received this month', money(sumInstallments(plan.currentEntries, 'paid'))],
    ['pending this month', money(sumInstallments(plan.currentEntries, 'pending'))],
    ['expenses this month', money(currentMonthExpenses.reduce((n, e) => n + e.amount, 0))],
    ['received (history)', money(sumInstallments(plan.historyEntries, 'paid'))],
  ]
}

/**
 * The current-month entry a featured patient's face diagram hangs off: their
 * most recent procedure that actually has diagram points ("Limpeza de pele
 * profunda" is not injectable and maps to none).
 */
function findFeaturedEntry(currentEntries: PlannedEntry[], patientIndex: number): PlannedEntry | undefined {
  const candidates = currentEntries.filter(
    (entry) =>
      entry.procedure.patientIndex === patientIndex &&
      buildFaceDiagramPoints(entry.procedure.procedureName).length > 0,
  )
  return candidates[candidates.length - 1]
}

function countFeaturedDiagrams(plan: SeedPlan): number {
  return plan.patients
    .slice(0, FEATURED_PATIENT_COUNT)
    .filter((_, patientIndex) => findFeaturedEntry(plan.currentEntries, patientIndex) !== undefined).length
}

// ─── Writing ─────────────────────────────────────────────────────────────

interface WriteContext {
  plan: SeedPlan
  practitionerId: string
  procedureTypeIdByName: Map<string, string>
  categoryIdByName: Map<string, string>
}

/** A past procedure resolved into the ids that link its rows together. */
interface PastRecord {
  entry: PlannedEntry
  appointmentId: string
  procedureRecordId: string
  financialEntryId: string
  /** Rotates product picks in the clinical notes so repeats don't read identically. */
  noteIndex: number
}

function patientIdFor(plan: SeedPlan, patientIndex: number): string {
  return plan.patients[patientIndex % plan.patients.length].id
}

async function assertTenantAbsent(runner: Tx | typeof db): Promise<void> {
  const [existing] = await runner
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(or(eq(tenants.id, DEMO_TENANT_ID), eq(tenants.slug, DEMO_SLUG)))
    .limit(1)

  if (existing) {
    throw new Error(
      `Refusing to run: a tenant already exists (id=${existing.id}, slug=${existing.slug}).\n` +
        'This script never updates or duplicates an existing tenant, and teardown is out of scope.\n' +
        'Remove that tenant by hand if you really want to re-seed.',
    )
  }
}

async function writeTenantAndUser(
  tx: Tx,
  ctx: WriteContext,
  passwordHash: string,
): Promise<void> {
  const now = new Date()

  await tx.insert(tenants).values({
    id: DEMO_TENANT_ID,
    name: CLINIC.name,
    slug: DEMO_SLUG,
    status: 'active',
    phone: CLINIC.phone,
    email: CLINIC.email,
    address: { city: CLINIC.city, state: CLINIC.state },
    // The whole safety story lives in this column. See verify.ts.
    settings: SAFETY_SETTINGS,
    createdAt: now,
    updatedAt: now,
  })

  await tx.insert(users).values({
    // users.id has no database default -- it mirrors Supabase auth ids.
    id: ctx.practitionerId,
    email: PRACTITIONER.email,
    fullName: PRACTITIONER.fullName,
    phone: CLINIC.phone,
    passwordHash,
    emailVerified: now,
    professionalTitle: PRACTITIONER.professionalTitle,
    registryType: PRACTITIONER.registryType,
    registryNumber: PRACTITIONER.registryNumber,
    registryState: PRACTITIONER.registryState,
    createdAt: now,
    updatedAt: now,
  })

  // 'owner', not 'practitioner': /api/dashboard passes a practitionerId when
  // the role is 'practitioner', and getQuickStats then returns
  // revenueThisMonth = null. The demo has to show revenue.
  await tx.insert(tenantUsers).values({
    tenantId: DEMO_TENANT_ID,
    userId: ctx.practitionerId,
    role: 'owner',
    isActive: true,
  })
}

async function writeSubscription(tx: Tx, todayYmd: string): Promise<{ name: string; slug: string; priceCents: number }> {
  const [plan] = await tx
    .select({ id: plans.id, name: plans.name, slug: plans.slug, priceCents: plans.priceCents })
    .from(plans)
    .where(eq(plans.active, true))
    .orderBy(desc(plans.priceCents), asc(plans.displayOrder))
    .limit(1)

  if (!plan) {
    throw new Error(
      'No active row found in floraclin.plans. tenant_subscriptions.plan_id references it, and this script will not invent one. Seed the plans table first.',
    )
  }

  const { year, month, day } = ymdParts(todayYmd)
  const nextYear = shiftMonth(year, month, 12)
  const endYmd = ymd(nextYear.year, nextYear.month, Math.min(day, daysInMonth(nextYear.year, nextYear.month)))

  await tx.insert(tenantSubscriptions).values({
    tenantId: DEMO_TENANT_ID,
    planId: plan.id,
    // 'active', never 'trialing': /api/cron/subscription-expiry only expires
    // subscriptions whose status is 'trialing', so this one is inert to it.
    status: 'active',
    source: 'admin',
    currentPeriodStart: new Date(),
    currentPeriodEnd: brInstant(endYmd, '12:00'),
  })

  return { name: plan.name, slug: plan.slug, priceCents: plan.priceCents }
}

async function writeCatalogue(tx: Tx, ctx: WriteContext): Promise<void> {
  const categoryNames = [...new Set(MONTHLY_EXPENSES.map((e) => e.category))]
  const categoryRows = categoryNames.map((name, index) => {
    const id = randomUUID()
    ctx.categoryIdByName.set(name, id)
    return { id, tenantId: DEMO_TENANT_ID, name, icon: 'circle', isSystem: false, sortOrder: index }
  })
  await inChunks(categoryRows, (chunk) => tx.insert(expenseCategories).values(chunk))

  const procedureRows = CATALOGUE.map((item) => {
    const id = randomUUID()
    ctx.procedureTypeIdByName.set(item.name, id)
    return {
      id,
      tenantId: DEMO_TENANT_ID,
      name: item.name,
      // NOT NULL in the schema.
      category: item.category,
      defaultPrice: money(item.price),
      estimatedDurationMin: item.durationMin,
      isActive: true,
    }
  })
  await inChunks(procedureRows, (chunk) => tx.insert(procedureTypes).values(chunk))
}

async function writePatients(tx: Tx, ctx: WriteContext): Promise<void> {
  const { year, month } = ymdParts(ctx.plan.todayYmd)
  const windowStart = shiftMonth(year, month, -(SIX_MONTH_RECEIVED.length - 1))
  const firstDay = ymd(windowStart.year, windowStart.month, 1)

  const rows = ctx.plan.patients.map((patient, index) => {
    // Spread signups across the history window, one per day, so the patient
    // list does not look like it was created in a single instant.
    const createdAt = brInstant(addDaysYmd(firstDay, index), '10:00')
    return {
      id: patient.id,
      tenantId: DEMO_TENANT_ID,
      responsibleUserId: ctx.practitionerId,
      fullName: patient.fullName,
      cpf: patient.cpf,
      // `date` column: a BR calendar day, stored as the YYYY-MM-DD string.
      birthDate: patient.birthDate,
      gender: patient.gender,
      email: patient.email,
      // NOT NULL in the schema, and always carries PHONE_PREFIX.
      phone: patient.phone,
      referralSource: patient.referralSource,
      createdAt,
      updatedAt: createdAt,
    }
  })

  await inChunks(rows, (chunk) => tx.insert(patients).values(chunk))
}

function planPastRecords(plan: SeedPlan): PastRecord[] {
  return [...plan.historyEntries, ...plan.currentEntries].map((entry, index) => ({
    entry,
    appointmentId: randomUUID(),
    procedureRecordId: randomUUID(),
    financialEntryId: randomUUID(),
    noteIndex: index,
  }))
}

async function writeAppointments(
  tx: Tx,
  ctx: WriteContext,
  pastRecords: PastRecord[],
): Promise<void> {
  const { plan } = ctx

  const pastRows = pastRecords.map(({ entry, appointmentId }) => {
    const { procedure } = entry
    const bookedAt = brInstant(procedure.date, '08:00')
    return {
      id: appointmentId,
      tenantId: DEMO_TENANT_ID,
      patientId: patientIdFor(plan, procedure.patientIndex),
      practitionerId: ctx.practitionerId,
      procedureTypeId: ctx.procedureTypeIdByName.get(procedure.procedureName)!,
      date: procedure.date,
      startTime: procedure.startTime,
      endTime: procedure.endTime,
      status: 'completed',
      source: 'internal',
      confirmedAt: bookedAt,
      createdAt: bookedAt,
      updatedAt: bookedAt,
    }
  })

  // Forward bookings read as made a few days ago, not this instant.
  const bookedAt = brInstant(addDaysYmd(plan.todayYmd, -3), '10:00')
  const upcomingRows = [...plan.todaySlots, ...plan.forwardSlots].map((slot) => ({
    id: randomUUID(),
    tenantId: DEMO_TENANT_ID,
    patientId: patientIdFor(plan, slot.patientIndex),
    practitionerId: ctx.practitionerId,
    procedureTypeId: ctx.procedureTypeIdByName.get(slot.procedureName)!,
    date: slot.date,
    startTime: slot.startTime,
    endTime: slot.endTime,
    status: slot.status,
    source: 'internal',
    notes: slot.notes ?? null,
    confirmedAt: slot.status === 'confirmed' ? bookedAt : null,
    createdAt: bookedAt,
    updatedAt: bookedAt,
  }))

  await inChunks(pastRows, (chunk) => tx.insert(appointments).values(chunk))
  await inChunks(upcomingRows, (chunk) => tx.insert(appointments).values(chunk))
}

async function writeProcedureRecords(tx: Tx, ctx: WriteContext, pastRecords: PastRecord[]): Promise<void> {
  const currentMonthPrefix = ctx.plan.todayYmd.slice(0, 7)

  const rows = pastRecords.map(({ entry, appointmentId, procedureRecordId, noteIndex }) => {
    const { procedure } = entry
    const performedAt = brInstant(procedure.date, procedure.startTime)
    const notes = buildProcedureNotes(procedure.procedureName, noteIndex)
    // Follow-ups only for this month's procedures, so the retornos screen
    // shows dates that are still ahead rather than a wall of stale ones.
    const followUpDate = procedure.date.startsWith(currentMonthPrefix)
      ? addDaysYmd(procedure.date, 30)
      : null

    return {
      id: procedureRecordId,
      tenantId: DEMO_TENANT_ID,
      patientId: patientIdFor(ctx.plan, procedure.patientIndex),
      practitionerId: ctx.practitionerId,
      procedureTypeId: ctx.procedureTypeIdByName.get(procedure.procedureName)!,
      // The link the plan calls for: this record came from that appointment.
      appointmentId,
      performedAt,
      technique: notes.technique,
      clinicalResponse: notes.clinicalResponse,
      notes: notes.notes,
      followUpDate,
      status: 'completed',
      approvedAt: performedAt,
      sessionsTotal: 1,
      createdAt: performedAt,
      updatedAt: performedAt,
    }
  })

  await inChunks(rows, (chunk) => tx.insert(procedureRecords).values(chunk))
}

/**
 * The lot-level traceability log: one row per distinct product used on each
 * past procedure's face diagram (see `buildProductApplications`), written
 * for every performed record, not only the `FEATURED_PATIENT_COUNT`
 * patients whose diagram is actually rendered. `noteIndex` is reused from
 * the same `PastRecord` so a repeat product on a later visit gets a
 * different-looking batch number, and `performedAt` is recomputed the same
 * way `writeProcedureRecords` does, so both rows agree on the instant.
 */
async function writeProductApplications(tx: Tx, pastRecords: PastRecord[]): Promise<number> {
  const rows = pastRecords.flatMap(({ entry, procedureRecordId, noteIndex }) => {
    const { procedure } = entry
    const performedAt = brInstant(procedure.date, procedure.startTime)
    return buildProductApplications(procedure.procedureName, noteIndex, performedAt).map((app) => ({
      tenantId: DEMO_TENANT_ID,
      procedureRecordId,
      productName: app.productName,
      activeIngredient: app.activeIngredient,
      totalQuantity: app.totalQuantity.toFixed(2),
      quantityUnit: app.quantityUnit,
      batchNumber: app.batchNumber,
      expirationDate: app.expirationDate,
      applicationAreas: app.applicationAreas,
      notes: app.notes,
    }))
  })

  await inChunks(rows, (chunk) => tx.insert(productApplications).values(chunk))
  return rows.length
}

async function writeFinancials(tx: Tx, ctx: WriteContext, pastRecords: PastRecord[]): Promise<void> {
  const entryRows = pastRecords.map(({ entry, appointmentId, procedureRecordId, financialEntryId }) => {
    const paidCount = entry.installments.filter((i) => i.status === 'paid').length
    const status =
      paidCount === entry.installments.length ? 'paid' : paidCount === 0 ? 'pending' : 'partial'

    return {
      id: financialEntryId,
      tenantId: DEMO_TENANT_ID,
      patientId: patientIdFor(ctx.plan, entry.procedure.patientIndex),
      procedureRecordId,
      appointmentId,
      description: entry.procedure.procedureName,
      totalAmount: money(entry.totalAmount),
      installmentCount: entry.installments.length,
      status,
      createdBy: ctx.practitionerId,
      // getRevenueOverview's SUMMARY filters on this column.
      createdAt: brInstant(entry.procedure.date, '12:00'),
      updatedAt: brInstant(entry.procedure.date, '12:00'),
    }
  })

  const installmentRows = pastRecords.flatMap(({ entry, financialEntryId }) =>
    entry.installments.map((installment) => {
      const paidAt = installment.paidAt ? brInstant(installment.paidAt, '12:00') : null
      return {
        tenantId: DEMO_TENANT_ID,
        financialEntryId,
        installmentNumber: installment.number,
        amount: money(installment.amount),
        // `date` column: a BR calendar day, stored as the YYYY-MM-DD string.
        dueDate: installment.dueDate,
        status: installment.status,
        // getRevenueOverview's monthly CHART groups on this column, and
        // getQuickStats sums this month's paid installments by it.
        paidAt,
        paymentMethod: installment.paymentMethod ?? null,
        amountPaid: installment.status === 'paid' ? money(installment.amount) : '0',
        createdAt: brInstant(entry.procedure.date, '12:00'),
        updatedAt: paidAt ?? brInstant(entry.procedure.date, '12:00'),
      }
    }),
  )

  await inChunks(entryRows, (chunk) => tx.insert(financialEntries).values(chunk))
  await inChunks(installmentRows, (chunk) => tx.insert(installments).values(chunk))
}

/**
 * One planned expense installment, resolved into the ids `writeCashMovements`
 * needs to link its outflow row back to `expense_installments` and
 * `expense_categories` -- the same two foreign keys `payExpenseInstallment`
 * sets when the app records a real expense payment.
 */
interface PlannedExpenseInstallment {
  id: string
  categoryId: string
  amount: number
  /** BR calendar day the expense installment was paid. */
  date: string
}

async function writeExpenses(tx: Tx, ctx: WriteContext): Promise<PlannedExpenseInstallment[]> {
  const expenseRows: Array<{ id: string; date: string; amount: number; categoryId: string }> = []

  const rows = ctx.plan.expenses.map((expense) => {
    const id = randomUUID()
    const categoryId = ctx.categoryIdByName.get(expense.category)!
    expenseRows.push({ id, date: expense.date, amount: expense.amount, categoryId })
    const recordedAt = brInstant(expense.date, '10:00')
    return {
      id,
      tenantId: DEMO_TENANT_ID,
      categoryId,
      description: expense.description,
      totalAmount: money(expense.amount),
      installmentCount: 1,
      status: 'paid',
      createdBy: ctx.practitionerId,
      // expense_installments carries no tenant_id: getRevenueOverview joins
      // through expenses and filters THIS column, so the parent is what has
      // to be back-dated.
      createdAt: recordedAt,
      updatedAt: recordedAt,
    }
  })

  // Pre-generated (rather than left to the column default) so
  // `writeCashMovements` can point `cash_movements.expense_installment_id`
  // at the right row without a round trip.
  const installmentPlans: PlannedExpenseInstallment[] = expenseRows.map((expense) => ({
    id: randomUUID(),
    categoryId: expense.categoryId,
    amount: expense.amount,
    date: expense.date,
  }))

  const installmentRows = expenseRows.map((expense, index) => ({
    id: installmentPlans[index].id,
    expenseId: expense.id,
    installmentNumber: 1,
    amount: money(expense.amount),
    dueDate: expense.date,
    status: 'paid',
    paidAt: brInstant(expense.date, '12:00'),
    paymentMethod: 'transfer',
  }))

  await inChunks(rows, (chunk) => tx.insert(expenses).values(chunk))
  await inChunks(installmentRows, (chunk) => tx.insert(expenseInstallments).values(chunk))

  return installmentPlans
}

/**
 * Writes the `cash_movements` rows the app itself would have written had
 * these installments been paid through `recordPayment` /
 * `payExpenseInstallment` instead of seeded pre-paid. One inflow per paid
 * receivable installment, one outflow per paid expense installment, each
 * dated to that installment's own `paidAt` so the ledger reconciles with
 * `getRevenueOverview`'s totals and the six-month chart.
 *
 * Shapes match the two write sites exactly:
 * - inflow: `web/src/db/queries/financial.ts` `recordPayment` step 5.
 * - outflow: `web/src/db/queries/expenses.ts` `payExpenseInstallment`.
 *
 * Neither a `payment_records` nor a `paymentRecordId` link is created --
 * that column is nullable and unused by any reader of this table
 * (`listCashMovements`, `getLedgerSummary`, `exportLedgerCSV`,
 * `listLedgerReportRows`), so it stays null here exactly as the schema
 * allows.
 */
async function writeCashMovements(
  tx: Tx,
  ctx: WriteContext,
  pastRecords: PastRecord[],
  expenseInstallmentPlans: PlannedExpenseInstallment[],
): Promise<number> {
  const inflowRows = pastRecords.flatMap(({ entry }) =>
    entry.installments
      .filter((installment): installment is typeof installment & { paidAt: string } =>
        installment.status === 'paid' && installment.paidAt !== undefined,
      )
      .map((installment) => ({
        tenantId: DEMO_TENANT_ID,
        type: 'inflow' as const,
        amount: money(installment.amount),
        description: `Pagamento: ${entry.procedure.procedureName}`,
        paymentMethod: installment.paymentMethod ?? null,
        movementDate: brInstant(installment.paidAt, '12:00'),
        patientId: patientIdFor(ctx.plan, entry.procedure.patientIndex),
        recordedBy: ctx.practitionerId,
      })),
  )

  const outflowRows = expenseInstallmentPlans.map((installment) => ({
    tenantId: DEMO_TENANT_ID,
    type: 'outflow' as const,
    // Matches `payExpenseInstallment`'s description exactly -- every
    // seeded expense has exactly one installment, so the number is always 1.
    amount: money(installment.amount),
    description: 'Despesa parcela 1',
    paymentMethod: 'transfer',
    movementDate: brInstant(installment.date, '12:00'),
    expenseInstallmentId: installment.id,
    expenseCategoryId: installment.categoryId,
    recordedBy: ctx.practitionerId,
  }))

  const rows = [...inflowRows, ...outflowRows]
  await inChunks(rows, (chunk) => tx.insert(cashMovements).values(chunk))
  return rows.length
}

/** Empty booleans plus the generated history paragraph in the free-text slot. */
function medicalHistoryFor(history: string) {
  return {
    diabetes: false,
    hipertensao: false,
    autoimune: false,
    cardiovascular: false,
    hepatite: false,
    hiv: false,
    cancer: false,
    epilepsia: false,
    disturbioCoagulacao: false,
    queloides: false,
    herpes: false,
    outros: history,
  }
}

async function writeClinicalRecords(tx: Tx, ctx: WriteContext, pastRecords: PastRecord[]): Promise<number> {
  const featured = ctx.plan.patients.slice(0, FEATURED_PATIENT_COUNT)
  const recordIdByEntry = new Map<PlannedEntry, string>(
    pastRecords.map((record) => [record.entry, record.procedureRecordId]),
  )

  const anamnesisRows = featured.map((patient, index) => {
    const demo = buildAnamnesis(patient, index)
    const recordedAt = brInstant(addDaysYmd(ctx.plan.todayYmd, -20 - index), '11:00')
    return {
      tenantId: DEMO_TENANT_ID,
      patientId: patient.id,
      // The zod schema in @/validations/anamnesis shapes these jsonb columns
      // as arrays of objects, not arrays of strings.
      allergies: demo.allergies.map((substance) => ({ substance, reaction: '' })),
      medications: demo.medications.map((name) => ({ name, dosage: '', frequency: '', reason: '' })),
      medicalHistory: medicalHistoryFor(demo.history),
      updatedBy: ctx.practitionerId,
      createdAt: recordedAt,
      updatedAt: recordedAt,
    }
  })

  await inChunks(anamnesisRows, (chunk) => tx.insert(anamneses).values(chunk))

  const diagramRows: Array<{ id: string; tenantId: string; procedureRecordId: string; viewType: string; createdAt: Date; updatedAt: Date }> = []
  const pointRows: Array<{
    tenantId: string
    faceDiagramId: string
    x: string
    y: string
    productName: string
    activeIngredient: string
    quantity: string
    quantityUnit: string
    technique: string
    depth: string
    notes: string
    sortOrder: number
  }> = []

  featured.forEach((_, patientIndex) => {
    const entry = findFeaturedEntry(ctx.plan.currentEntries, patientIndex)
    if (!entry) return
    const procedureRecordId = recordIdByEntry.get(entry)
    if (!procedureRecordId) return

    const diagramId = randomUUID()
    const drawnAt = brInstant(entry.procedure.date, entry.procedure.startTime)
    diagramRows.push({
      id: diagramId,
      tenantId: DEMO_TENANT_ID,
      procedureRecordId,
      viewType: 'front',
      createdAt: drawnAt,
      updatedAt: drawnAt,
    })

    for (const point of buildFaceDiagramPoints(entry.procedure.procedureName)) {
      pointRows.push({
        tenantId: DEMO_TENANT_ID,
        faceDiagramId: diagramId,
        x: point.x.toFixed(2),
        y: point.y.toFixed(2),
        productName: point.productName,
        activeIngredient: point.activeIngredient,
        quantity: point.quantity.toFixed(2),
        quantityUnit: point.quantityUnit,
        technique: point.technique,
        depth: point.depth,
        notes: point.notes,
        sortOrder: point.sortOrder,
      })
    }
  })

  await inChunks(diagramRows, (chunk) => tx.insert(faceDiagrams).values(chunk))
  await inChunks(pointRows, (chunk) => tx.insert(diagramPoints).values(chunk))

  return pointRows.length
}

async function writeProspects(tx: Tx, ctx: WriteContext): Promise<void> {
  const prospectRows: Array<{ id: string; prospect: DemoProspect }> = []

  const rows = ctx.plan.prospects.map((prospect) => {
    const id = randomUUID()
    prospectRows.push({ id, prospect })
    return {
      id,
      tenantId: DEMO_TENANT_ID,
      name: prospect.name,
      phone: prospect.phone,
      source: prospect.source,
      stage: prospect.stage,
      intent: prospect.intent,
      sentiment: prospect.sentiment,
      value: money(prospect.value),
      lostReason: prospect.lostReason ?? null,
      createdAt: brInstant(prospect.createdAt, '10:00'),
      updatedAt: brInstant(prospect.updatedAt, '17:00'),
    }
  })

  const activityRows = prospectRows.flatMap(({ id, prospect }) =>
    prospect.activities.map((activity, index) => ({
      tenantId: DEMO_TENANT_ID,
      prospectId: id,
      action: activity.action,
      details: activity.details,
      performedBy: ctx.practitionerId,
      // Minutes apart within the day so the detail panel orders them the way
      // the generator intended even when two land on the same date.
      createdAt: brInstant(activity.date, minutesToHHMM(10 * 60 + index * 25)),
    })),
  )

  await inChunks(rows, (chunk) => tx.insert(prospects).values(chunk))
  await inChunks(activityRows, (chunk) => tx.insert(prospectActivities).values(chunk))
}

async function writeConversations(tx: Tx, ctx: WriteContext): Promise<void> {
  const conversationRows: Array<{ id: string; conversation: DemoWhatsappConversation }> = []

  const rows = ctx.plan.conversations.map((conversation) => {
    const id = randomUUID()
    conversationRows.push({ id, conversation })
    const lastMessageAt = brInstant(conversation.lastMessageDate, conversation.lastMessageTime)
    return {
      id,
      tenantId: DEMO_TENANT_ID,
      phoneNumber: conversation.phoneNumber,
      profileName: conversation.profileName,
      patientId: conversation.patientId,
      lastMessageAt,
      lastInboundAt:
        conversation.lastInboundDate && conversation.lastInboundTime
          ? brInstant(conversation.lastInboundDate, conversation.lastInboundTime)
          : null,
      unreadCount: conversation.unreadCount,
      status: conversation.status,
      createdAt: lastMessageAt,
      updatedAt: lastMessageAt,
    }
  })

  const messageRows = conversationRows.flatMap(({ id, conversation }) =>
    conversation.messages.map((message) => {
      const sentAt = brInstant(message.date, message.time)
      return {
        tenantId: DEMO_TENANT_ID,
        conversationId: id,
        direction: message.direction,
        body: message.body,
        // Terminal states only. Nothing here is still in flight, and no
        // whatsapp_queued_messages row is ever created.
        deliveryStatus: message.deliveryStatus,
        timestamp: sentAt,
        createdAt: sentAt,
      }
    }),
  )

  await inChunks(rows, (chunk) => tx.insert(whatsappConversations).values(chunk))
  await inChunks(messageRows, (chunk) => tx.insert(whatsappMessages).values(chunk))
}

async function writePhotos(tx: Tx, ctx: WriteContext): Promise<void> {
  const assetRows: Array<{
    id: string
    tenantId: string
    patientId: string
    storagePath: string
    originalFilename: string
    mimeType: string
    timelineStage: string
    takenAt: Date
    uploadedBy: string
    notes: string
    createdAt: Date
  }> = []
  const annotationRows: Array<{
    tenantId: string
    photoAssetId: string
    annotationData: unknown
    createdBy: string
    createdAt: Date
    updatedAt: Date
  }> = []

  for (const pair of ctx.plan.photoPairs) {
    const patientId = patientIdFor(ctx.plan, pair.patientIndex)

    for (const [asset, daysAgo] of [
      [pair.before, 60],
      [pair.after, 30],
    ] as const) {
      const id = randomUUID()
      const takenAt = brInstant(addDaysYmd(ctx.plan.todayYmd, -daysAgo), '14:00')
      assetRows.push({
        id,
        tenantId: DEMO_TENANT_ID,
        patientId,
        // Same convention the upload route uses (@/lib/storage getStoragePath).
        // The bytes themselves are NOT uploaded by this script: it only writes
        // to the database. See the report / runbook.
        storagePath: getStoragePath(DEMO_TENANT_ID, patientId, asset.originalFilename),
        originalFilename: asset.originalFilename,
        mimeType: asset.mimeType,
        timelineStage: asset.timelineStage,
        takenAt,
        uploadedBy: ctx.practitionerId,
        notes: asset.notes,
        createdAt: takenAt,
      })
      annotationRows.push({
        tenantId: DEMO_TENANT_ID,
        photoAssetId: id,
        annotationData: asset.annotation.annotationData,
        createdBy: ctx.practitionerId,
        createdAt: takenAt,
        updatedAt: takenAt,
      })
    }
  }

  await inChunks(assetRows, (chunk) => tx.insert(photoAssets).values(chunk))
  await inChunks(annotationRows, (chunk) => tx.insert(photoAnnotations).values(chunk))
}

// ─── CLI ─────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const dryRun = process.argv.includes('--dry-run')

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Refusing to run.')
    return 1
  }

  console.log(`Clínica Lumé seed${dryRun ? ' (DRY RUN, nothing will be written)' : ''}`)
  console.log(`Tenant: ${DEMO_TENANT_ID} (${DEMO_SLUG})`)
  console.log('')

  const plan = buildPlan()
  printTable('Planned rows', describePlan(plan))

  if (dryRun) {
    const [existing] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(or(eq(tenants.id, DEMO_TENANT_ID), eq(tenants.slug, DEMO_SLUG)))
      .limit(1)

    if (existing) {
      console.log('WARNING: the demo tenant already exists. A real run would refuse to write.')
    } else {
      console.log('Dry run complete. Nothing was written.')
    }
    return 0
  }

  await assertTenantAbsent(db)

  const practitionerId = randomUUID()
  const password = `Lume-${randomBytes(6).toString('hex')}`
  // Cost 10, matching src/actions/signup.ts; the credentials provider in
  // src/lib/auth-config.ts verifies with bcrypt.compare against this column.
  const passwordHash = await bcrypt.hash(password, 10)

  const ctx: WriteContext = {
    plan,
    practitionerId,
    procedureTypeIdByName: new Map(),
    categoryIdByName: new Map(),
  }
  const pastRecords = planPastRecords(plan)

  let planLabel = ''
  let diagramPointCount = 0
  let productApplicationCount = 0
  let cashMovementCount = 0

  await db.transaction(async (tx) => {
    // Re-checked inside the transaction: the pre-flight check above is a
    // friendlier error, this one is the one that actually holds.
    await assertTenantAbsent(tx)

    await writeTenantAndUser(tx, ctx, passwordHash)
    const chosenPlan = await writeSubscription(tx, plan.todayYmd)
    planLabel = `${chosenPlan.name} (${chosenPlan.slug}, ${chosenPlan.priceCents} cents)`

    await writeCatalogue(tx, ctx)
    await writePatients(tx, ctx)
    await writeAppointments(tx, ctx, pastRecords)
    await writeProcedureRecords(tx, ctx, pastRecords)
    productApplicationCount = await writeProductApplications(tx, pastRecords)
    await writeFinancials(tx, ctx, pastRecords)
    const expenseInstallmentPlans = await writeExpenses(tx, ctx)
    cashMovementCount = await writeCashMovements(tx, ctx, pastRecords, expenseInstallmentPlans)
    diagramPointCount = await writeClinicalRecords(tx, ctx, pastRecords)
    await writeProspects(tx, ctx)
    await writeConversations(tx, ctx)
    await writePhotos(tx, ctx)
  })

  console.log('')
  printTable('Written', [
    ...describePlan(plan),
    ['diagram_points (actual)', diagramPointCount],
    ['product_applications (actual)', productApplicationCount],
    ['cash_movements (actual)', cashMovementCount],
    ['subscription plan', planLabel],
  ])

  console.log('Verifying...')
  const safety = await runSafetyAssertions()
  const targets = await runTargetAssertions()
  const failures = [...safety.failures, ...targets]

  if (!safety.tenantPresent) {
    console.error('  FAIL  the tenant is missing after a committed transaction')
    return 1
  }

  if (failures.length > 0) {
    console.error(`  FAIL  ${failures.length} assertion(s):`)
    for (const failure of failures) console.error(`        - ${failure}`)
    console.error('')
    console.error('The data was committed. Investigate before using it for screenshots.')
    return 1
  }

  console.log('  OK  every safety and target assertion passed')
  console.log('')
  console.log('Login:')
  console.log(`  email    ${PRACTITIONER.email}`)
  console.log(`  password ${password}`)
  console.log('')
  console.log('This password is shown once and is not stored anywhere in plain text.')
  console.log(
    `Targets: ${TARGETS.proceduresThisMonth} procedimentos, R$ ${TARGETS.receivedThisMonth} recebido, R$ ${TARGETS.pendingThisMonth} a receber, R$ ${TARGETS.netProfitThisMonth} de lucro.`,
  )
  console.log('Photo bytes are not uploaded by this script: photo_assets rows point at storage paths that must be filled separately.')

  return 0
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    })
}
