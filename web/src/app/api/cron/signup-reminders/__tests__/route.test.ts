// @vitest-environment node
/**
 * The DB-backed suite (db/queries/__tests__/signup-reminders.test.ts) needs a
 * test database; this one pins the cron's wiring without one: which reminder
 * goes with which key and copy, that a lost claim sends nothing, and the age
 * windows the selection queries put in their SQL.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'

const { captured, claims, sendConfirmMock, sendFinishMock, getUrlMock, finishMock } = vi.hoisted(() => ({
  captured: [] as { sql: string; params: unknown[] }[],
  claims: new Map<string, string | null>(),
  sendConfirmMock: vi.fn(),
  sendFinishMock: vi.fn(),
  getUrlMock: vi.fn(),
  finishMock: vi.fn(),
}))

// Rows per selection query, told apart by the message key in their params.
const rowsByKey: Record<string, { tenant_id: string; tenant_name: string; owner_email: string }[]> = {}

vi.mock('@/db/client', () => ({
  db: drizzle(async (sql: string, params: unknown[]) => {
    captured.push({ sql, params })
    if (sql.trimStart().startsWith('insert into floraclin.tenant_lifecycle_messages')) {
      const key = `${params[0]}:${params[1]}`
      const id = claims.has(key) ? claims.get(key)! : `claim-${key}`
      return { rows: id ? [[id]] : [] }
    }
    const key = params.find((p) => typeof p === 'string' && p.startsWith('signup_')) as string
    return { rows: (rowsByKey[key] ?? []).map((r) => [r.tenant_id, r.tenant_name, r.owner_email]) }
  }),
}))
vi.mock('@/db/queries/admin-tenants', () => ({
  // pg-proxy hands back arrays; map them onto the selected column names.
  rowsFromExecuteResult: (result: unknown[][] | { rows: unknown[][] }) =>
    (Array.isArray(result) ? result : result.rows).map((row) =>
      row.length === 1 ? { id: row[0] } : { tenant_id: row[0], tenant_name: row[1], owner_email: row[2] },
    ),
}))
vi.mock('@/db/queries/lifecycle', () => ({ finishLifecycleSend: finishMock }))
vi.mock('@/lib/email', () => ({
  sendConfirmationReminderEmail: sendConfirmMock,
  sendFinishSetupReminderEmail: sendFinishMock,
}))
vi.mock('@/lib/confirm-email', async (importOriginal) => ({
  MIN_LINK_VALIDITY_MS: (await importOriginal<typeof import('@/lib/confirm-email')>()).MIN_LINK_VALIDITY_MS,
  getOrIssueConfirmationUrl: getUrlMock,
}))
vi.mock('@/lib/cron-monitor', () => ({ withCronMonitor: (_s: string, _c: string, run: () => unknown) => run() }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))
vi.mock('@/lib/api-error', () => ({
  handleApiError: (error: unknown) => {
    throw error
  },
}))

import { GET } from '../route'
import { SIGNUP_CONFIRM_FINAL_REMINDER_KEY, SIGNUP_CONFIRM_REMINDER_KEY } from '@/db/queries/signup-reminders'
import { MIN_LINK_VALIDITY_MS } from '@/lib/confirm-email'

const SECRET = 'cron-secret'
const run = () => GET(new Request('http://localhost/api/cron/signup-reminders', { headers: { authorization: `Bearer ${SECRET}` } }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', SECRET)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  captured.length = 0
  claims.clear()
  for (const key of Object.keys(rowsByKey)) delete rowsByKey[key]
  sendConfirmMock.mockResolvedValue({ id: 'resend-1' })
  getUrlMock.mockImplementation(async (email: string) => `https://app.test/api/auth/confirm?email=${email}&token=t`)
})

describe('signup-reminders cron: confirm reminders', () => {
  it('sends the 1 hour reminder as the first and the 24 hour one as the last, each under its own key', async () => {
    rowsByKey[SIGNUP_CONFIRM_REMINDER_KEY] = [{ tenant_id: 't1', tenant_name: 'Clínica Um', owner_email: 'um@x.test' }]
    rowsByKey[SIGNUP_CONFIRM_FINAL_REMINDER_KEY] = [{ tenant_id: 't2', tenant_name: 'Clínica Dois', owner_email: 'dois@x.test' }]

    expect((await run()).status).toBe(200)

    expect(sendConfirmMock).toHaveBeenCalledTimes(2)
    expect(sendConfirmMock).toHaveBeenCalledWith('um@x.test', expect.stringContaining('/api/auth/confirm?'), 'Clínica Um', 'first')
    expect(sendConfirmMock).toHaveBeenCalledWith('dois@x.test', expect.stringContaining('/api/auth/confirm?'), 'Clínica Dois', 'last')
    const claimed = captured
      .filter((q) => q.sql.trimStart().startsWith('insert into floraclin.tenant_lifecycle_messages'))
      .map((q) => `${q.params[0]}:${q.params[1]}`)
    expect(claimed.sort()).toEqual([`t1:${SIGNUP_CONFIRM_REMINDER_KEY}`, `t2:${SIGNUP_CONFIRM_FINAL_REMINDER_KEY}`])
  })

  it('sends nothing when another run already holds the claim', async () => {
    rowsByKey[SIGNUP_CONFIRM_FINAL_REMINDER_KEY] = [{ tenant_id: 't2', tenant_name: 'Clínica Dois', owner_email: 'dois@x.test' }]
    claims.set(`t2:${SIGNUP_CONFIRM_FINAL_REMINDER_KEY}`, null)

    await run()

    expect(sendConfirmMock).not.toHaveBeenCalled()
    expect(finishMock).not.toHaveBeenCalled()
  })

  it('asks for a link with hours left, so the 24 hour reminder never resends one about to expire', async () => {
    rowsByKey[SIGNUP_CONFIRM_FINAL_REMINDER_KEY] = [{ tenant_id: 't2', tenant_name: 'Clínica Dois', owner_email: 'dois@x.test' }]

    await run()

    expect(getUrlMock).toHaveBeenCalledWith('dois@x.test', MIN_LINK_VALIDITY_MS)
    expect(MIN_LINK_VALIDITY_MS).toBeGreaterThanOrEqual(6 * 60 * 60 * 1000)
  })

  it('selects the first reminder from 1 to 24 hours and the last from 24 hours to 7 days, never overlapping', async () => {
    await run()

    const windowOf = (key: string) => {
      const query = captured.find((q) => q.params.includes(key) && q.sql.includes('created_at <= now()'))!
      // The two created_at bounds come first; a later interval is another rule.
      const intervals = query.params.filter((p) => typeof p === 'string' && /^\d+ (hour|hours|days)$/.test(p))
      return intervals.slice(0, 2)
    }
    expect(windowOf(SIGNUP_CONFIRM_REMINDER_KEY)).toEqual(['1 hour', '24 hours'])
    expect(windowOf(SIGNUP_CONFIRM_FINAL_REMINDER_KEY)).toEqual(['24 hours', '7 days'])
    // Only unconfirmed password sign-ups: not Google/magic link/invited accounts.
    const finalQuery = captured.find((q) => q.params.includes(SIGNUP_CONFIRM_FINAL_REMINDER_KEY))!
    expect(finalQuery.sql).toMatch(/o\.password_hash is not null and o\.email_verified is null/)
    expect(finalQuery.sql).toMatch(/t\.deleted_at is null/)
  })

  // Catches the last reminder going out right after the first (one sent at 23 hours, the next at 24).
  it('holds the last reminder back until 12 hours after the first one went out', async () => {
    await run()

    const finalQuery = captured.find((q) => q.params.includes(SIGNUP_CONFIRM_FINAL_REMINDER_KEY))!
    expect(finalQuery.params).toContain(SIGNUP_CONFIRM_REMINDER_KEY)
    expect(finalQuery.params).toContain('12 hours')
    expect(finalQuery.sql).toMatch(
      /and not exists \(\s*select 1 from floraclin\.tenant_lifecycle_messages f\s+where f\.tenant_id = t\.id and f\.message_key = \$\d+ and f\.channel = 'email'\s+and f\.status <> 'failed'\s+and coalesce\(f\.completed_at, f\.claimed_at\) > now\(\) - \$\d+::interval/,
    )
    // The first reminder's own query has no such rule.
    const firstQuery = captured.find((q) => q.params.includes(SIGNUP_CONFIRM_REMINDER_KEY) && !q.params.includes(SIGNUP_CONFIRM_FINAL_REMINDER_KEY))!
    expect(firstQuery.params).not.toContain('12 hours')
  })

  // Catches both confirm reminders going out in one run to a clinic that turns
  // 24 hours old between the two lookups: the last one's 12 hour rule only sees
  // the first reminder once its claim is written.
  it('looks up the last reminder only after the first ones were claimed', async () => {
    rowsByKey[SIGNUP_CONFIRM_REMINDER_KEY] = [{ tenant_id: 't1', tenant_name: 'Clínica Um', owner_email: 'um@x.test' }]

    await run()

    const firstClaim = captured.findIndex(
      (q) => q.sql.trimStart().startsWith('insert into floraclin.tenant_lifecycle_messages') && q.params[1] === SIGNUP_CONFIRM_REMINDER_KEY,
    )
    const finalLookup = captured.findIndex((q) => q.params.includes(SIGNUP_CONFIRM_FINAL_REMINDER_KEY))
    expect(firstClaim).toBeGreaterThanOrEqual(0)
    expect(finalLookup).toBeGreaterThan(firstClaim)
  })

  it('refuses a call without the cron secret', async () => {
    const res = await GET(new Request('http://localhost/api/cron/signup-reminders'))
    expect(res.status).toBe(401)
    expect(sendConfirmMock).not.toHaveBeenCalled()
  })
})
