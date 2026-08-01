/**
 * Verification for the Clínica Lumé demo seed.
 *
 * Two modes:
 *
 * 1. `--safety-only` -- the pre-flight gate. Safe to run against PRODUCTION
 *    before anything has been seeded: it only reads, and it exits 0 with a
 *    clear message when the tenant does not exist yet. It answers one
 *    question: can this tenant ever cause an outbound message?
 * 2. default -- everything `--safety-only` checks, plus the financial and
 *    clinical targets, read back through the same query functions the app's
 *    screens call (`getQuickStats`, `getRevenueOverview`), so a green run
 *    means the screens themselves are right, not just the rows.
 *
 * Exits non-zero listing every failed assertion (never on the first one, so
 * one run tells the operator everything that is wrong).
 *
 * Why these specific safety assertions:
 *
 * - `web/src/app/api/cron/whatsapp-automations/route.ts` selects every tenant
 *   and then keeps the ones where
 *     `const mode = settings?.whatsapp_mode ?? 'floraclin'`
 *     `if (mode === 'floraclin') return true`
 *     `return settings?.whatsapp_enabled`
 *   So a tenant is excluded only when `whatsapp_mode` is set to something
 *   other than 'floraclin' AND `whatsapp_enabled` is falsy. An unset mode
 *   defaults to 'floraclin' and is therefore INCLUDED -- which is why the
 *   check below requires the mode to be present, not merely different.
 *   `web/vercel.json` runs that cron at `0 11 * * *` (08:00 BRT) every day,
 *   so this is exercised the morning after any seed.
 * - `whatsapp_automations` / `whatsapp_credits` / `whatsapp_queued_messages`
 *   must be empty: the cron needs an enabled automation row to send anything,
 *   the credit rows are what a send debits, and a queued message is a send
 *   that has already been decided on.
 * - `calendar_connections` must be empty so connecting Google mid-shoot
 *   cannot start an outbound sync unnoticed.
 * - Every patient phone carries `PHONE_PREFIX` and every email ends in
 *   `@example.com` (RFC 2606 reserved), so even a send that somehow escaped
 *   could not reach a real person.
 *
 * NOTE: `whatsapp_conversations` is deliberately NOT asserted empty. The seed
 * writes conversation and message rows directly (see
 * `web/src/lib/demo-seed/engagement.ts`) so the inbox is not blank in a
 * screenshot. Those rows are inert: the cron never reads them, and every
 * message carries a terminal delivery status. The `whatsapp_queued_messages`
 * assertion below is the one that proves nothing is still in flight.
 */

import { pathToFileURL } from 'node:url'
import { count, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  calendarConnections,
  patients,
  tenants,
  whatsappAutomations,
  whatsappCredits,
  whatsappQueuedMessages,
} from '@/db/schema'
import { getQuickStats } from '@/db/queries/dashboard'
import { getRevenueOverview } from '@/db/queries/financial'
import { brToday } from '@/lib/dates'
import {
  DEMO_TENANT_ID,
  EMAIL_DOMAIN,
  PHONE_PREFIX,
  SIX_MONTH_RECEIVED,
  TARGETS,
} from '@/lib/demo-seed/config'

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

/** The BR calendar month `today` falls in, as an inclusive YYYY-MM-DD range. */
export function currentMonthRange(todayYmd: string): { from: string; to: string } {
  const { year, month } = ymdParts(todayYmd)
  return { from: ymd(year, month, 1), to: ymd(year, month, daysInMonth(year, month)) }
}

/** The six-month window ending with the month `today` falls in. */
export function sixMonthRange(todayYmd: string): { from: string; to: string } {
  const { year, month } = ymdParts(todayYmd)
  const start = shiftMonth(year, month, -(SIX_MONTH_RECEIVED.length - 1))
  return {
    from: ymd(start.year, start.month, 1),
    to: ymd(year, month, daysInMonth(year, month)),
  }
}

/** The expected `YYYY-MM` labels of the six-month chart, oldest first. */
export function sixMonthLabels(todayYmd: string): string[] {
  const { year, month } = ymdParts(todayYmd)
  return SIX_MONTH_RECEIVED.map((_, index) => {
    const shifted = shiftMonth(year, month, index - (SIX_MONTH_RECEIVED.length - 1))
    return `${shifted.year}-${String(shifted.month).padStart(2, '0')}`
  })
}

// ─── Assertion helpers ───────────────────────────────────────────────────

/**
 * Postgres returns `numeric` as a string through postgres-js, and the query
 * layer passes several of those straight through, so every money comparison
 * goes through `Number()` rather than `===` on the raw value.
 */
function expectAmount(failures: string[], label: string, actual: unknown, expected: number): void {
  const value = Number(actual)
  if (value !== expected) {
    failures.push(`${label}: expected ${expected}, got ${Number.isNaN(value) ? String(actual) : value}`)
  }
}

function expectZeroRows(failures: string[], label: string, actual: number): void {
  if (actual !== 0) failures.push(`${label}: expected 0 rows for the demo tenant, found ${actual}`)
}

async function countForTenant(
  table: typeof whatsappAutomations | typeof whatsappCredits | typeof whatsappQueuedMessages | typeof calendarConnections,
): Promise<number> {
  const [row] = await db.select({ n: count() }).from(table).where(eq(table.tenantId, DEMO_TENANT_ID))
  return Number(row?.n ?? 0)
}

// ─── Safety mode ─────────────────────────────────────────────────────────

export interface SafetyResult {
  tenantPresent: boolean
  failures: string[]
}

/**
 * Read-only. Safe to run against production at any time, including before
 * the tenant exists.
 */
export async function runSafetyAssertions(): Promise<SafetyResult> {
  const failures: string[] = []

  const [tenant] = await db
    .select({ id: tenants.id, slug: tenants.slug, settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, DEMO_TENANT_ID))
    .limit(1)

  if (!tenant) return { tenantPresent: false, failures }

  const settings = (tenant.settings ?? {}) as Record<string, unknown>
  const mode = settings.whatsapp_mode

  if (typeof mode !== 'string' || mode.length === 0) {
    failures.push(
      'settings.whatsapp_mode is unset: the WhatsApp automations cron treats an unset mode as \'floraclin\' and would INCLUDE this tenant',
    )
  } else if (mode === 'floraclin') {
    failures.push("settings.whatsapp_mode is 'floraclin': the WhatsApp automations cron includes this tenant")
  }

  if (settings.whatsapp_enabled) {
    failures.push(
      `settings.whatsapp_enabled is truthy (${JSON.stringify(settings.whatsapp_enabled)}): the WhatsApp automations cron includes this tenant`,
    )
  }

  const [automations, credits, queued, connections] = await Promise.all([
    countForTenant(whatsappAutomations),
    countForTenant(whatsappCredits),
    countForTenant(whatsappQueuedMessages),
    countForTenant(calendarConnections),
  ])

  expectZeroRows(failures, 'whatsapp_automations', automations)
  expectZeroRows(failures, 'whatsapp_credits', credits)
  expectZeroRows(failures, 'whatsapp_queued_messages', queued)
  expectZeroRows(failures, 'calendar_connections', connections)

  const contacts = await db
    .select({ id: patients.id, fullName: patients.fullName, phone: patients.phone, email: patients.email })
    .from(patients)
    .where(eq(patients.tenantId, DEMO_TENANT_ID))

  for (const contact of contacts) {
    if (!contact.phone?.startsWith(PHONE_PREFIX)) {
      failures.push(`patient "${contact.fullName}" phone ${JSON.stringify(contact.phone)} does not start with ${PHONE_PREFIX}`)
    }
    if (!contact.email?.endsWith(`@${EMAIL_DOMAIN}`)) {
      failures.push(`patient "${contact.fullName}" email ${JSON.stringify(contact.email)} does not end with @${EMAIL_DOMAIN}`)
    }
  }

  return { tenantPresent: true, failures }
}

// ─── Target mode ─────────────────────────────────────────────────────────

/**
 * Reads the numbers back through the very query functions the dashboard and
 * the financial overview call, so a pass means those screens are right.
 */
export async function runTargetAssertions(): Promise<string[]> {
  const failures: string[] = []
  const todayYmd = brToday()

  const stats = await getQuickStats(DEMO_TENANT_ID)
  if (stats.proceduresThisMonth !== TARGETS.proceduresThisMonth) {
    failures.push(
      `getQuickStats.proceduresThisMonth: expected ${TARGETS.proceduresThisMonth}, got ${stats.proceduresThisMonth}`,
    )
  }
  expectAmount(failures, 'getQuickStats.revenueThisMonth', stats.revenueThisMonth, TARGETS.receivedThisMonth)

  const month = currentMonthRange(todayYmd)
  const overview = await getRevenueOverview(DEMO_TENANT_ID, month.from, month.to)

  expectAmount(failures, 'getRevenueOverview.summary.totalReceived', overview.summary.totalReceived, TARGETS.receivedThisMonth)
  expectAmount(failures, 'getRevenueOverview.summary.totalPending', overview.summary.totalPending, TARGETS.pendingThisMonth)
  expectAmount(failures, 'getRevenueOverview.summary.totalOverdue', overview.summary.totalOverdue, 0)
  expectAmount(failures, 'getRevenueOverview.summary.totalExpenses', overview.summary.totalExpenses, TARGETS.expensesThisMonth)
  expectAmount(failures, 'getRevenueOverview.summary.netProfit', overview.summary.netProfit, TARGETS.netProfitThisMonth)

  const window = sixMonthRange(todayYmd)
  const sixMonths = await getRevenueOverview(DEMO_TENANT_ID, window.from, window.to)
  const labels = sixMonthLabels(todayYmd)

  if (sixMonths.monthly.length !== SIX_MONTH_RECEIVED.length) {
    failures.push(
      `getRevenueOverview.monthly: expected ${SIX_MONTH_RECEIVED.length} months, got ${sixMonths.monthly.length} (${sixMonths.monthly
        .map((m) => m.month)
        .join(', ')})`,
    )
  }

  labels.forEach((label, index) => {
    const row = sixMonths.monthly.find((m) => m.month === label)
    if (!row) {
      failures.push(`getRevenueOverview.monthly: no row for ${label} (expected ${SIX_MONTH_RECEIVED[index]})`)
      return
    }
    expectAmount(failures, `getRevenueOverview.monthly[${label}]`, row.total, SIX_MONTH_RECEIVED[index])
  })

  return failures
}

// ─── CLI ─────────────────────────────────────────────────────────────────

function report(title: string, failures: string[]): void {
  if (failures.length === 0) {
    console.log(`  OK  ${title}`)
    return
  }
  console.error(`  FAIL  ${title}`)
  for (const failure of failures) console.error(`        - ${failure}`)
}

async function main(): Promise<number> {
  const safetyOnly = process.argv.includes('--safety-only')

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Refusing to run.')
    return 1
  }

  console.log(`Clínica Lumé verify (${safetyOnly ? 'safety-only' : 'full'})`)
  console.log(`Tenant: ${DEMO_TENANT_ID}`)
  console.log('')

  const safety = await runSafetyAssertions()

  if (!safety.tenantPresent) {
    console.log('  tenant absent, nothing to check')
    return 0
  }

  report('safety', safety.failures)

  let targetFailures: string[] = []
  if (!safetyOnly) {
    targetFailures = await runTargetAssertions()
    report('targets', targetFailures)
  }

  const total = safety.failures.length + targetFailures.length
  console.log('')
  console.log(total === 0 ? 'All assertions passed.' : `${total} assertion(s) failed.`)
  return total === 0 ? 0 : 1
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
