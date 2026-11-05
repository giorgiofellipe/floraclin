// @vitest-environment node
/**
 * The DB-backed suite (db/queries/__tests__/signup-reminders.test.ts) needs a
 * test database; this one pins the cron's wiring without one: which reminder
 * goes with which key and copy, that a lost claim sends nothing, and the order
 * of the lookups.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'

const { captured, claims, sendConfirmMock, sendFinishMock, getUrlMock, finishMock, awaitingMock } = vi.hoisted(() => ({
  captured: [] as { sql: string; params: unknown[] }[],
  claims: new Map<string, string | null>(),
  sendConfirmMock: vi.fn(),
  sendFinishMock: vi.fn(),
  getUrlMock: vi.fn(),
  finishMock: vi.fn(),
  awaitingMock: vi.fn(),
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
vi.mock('@/lib/email-confirmation-gate', () => ({ isTenantAwaitingEmailConfirmation: awaitingMock }))
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
  awaitingMock.mockResolvedValue(true)
  getUrlMock.mockImplementation(async (email: string) => `https://app.test/api/auth/confirm?email=${email}&token=t`)
})

describe('signup-reminders cron: confirm reminders', () => {
  it('sends the 1 hour reminder as the first and the 24 hour one as the last, each under its own key', async () => {
    rowsByKey[SIGNUP_CONFIRM_REMINDER_KEY] = [{ tenant_id: 't1', tenant_name: 'Clínica Um', owner_email: 'um@x.test' }]
    rowsByKey[SIGNUP_CONFIRM_FINAL_REMINDER_KEY] = [{ tenant_id: 't2', tenant_name: 'Clínica Dois', owner_email: 'dois@x.test' }]

    expect((await run()).status).toBe(200)

    expect(sendConfirmMock).toHaveBeenCalledTimes(2)
    // Each under the idempotency key of its own claim, so a retried claim cannot deliver twice.
    expect(sendConfirmMock).toHaveBeenCalledWith(
      'um@x.test',
      expect.stringContaining('/api/auth/confirm?'),
      'Clínica Um',
      'first',
      `signup-reminder/t1/${SIGNUP_CONFIRM_REMINDER_KEY}`,
    )
    expect(sendConfirmMock).toHaveBeenCalledWith(
      'dois@x.test',
      expect.stringContaining('/api/auth/confirm?'),
      'Clínica Dois',
      'last',
      `signup-reminder/t2/${SIGNUP_CONFIRM_FINAL_REMINDER_KEY}`,
    )
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

  // Catches "você ainda não confirmou" (and a fresh token) reaching an owner
  // who confirmed after the batch was selected.
  it('skips an owner who confirmed after the batch was selected', async () => {
    rowsByKey[SIGNUP_CONFIRM_REMINDER_KEY] = [{ tenant_id: 't1', tenant_name: 'Clínica Um', owner_email: 'um@x.test' }]
    awaitingMock.mockResolvedValue(false)

    await run()

    expect(sendConfirmMock).not.toHaveBeenCalled()
    expect(getUrlMock).not.toHaveBeenCalled()
  })

  it('asks for a link with at least MIN_LINK_VALIDITY_MS left', async () => {
    rowsByKey[SIGNUP_CONFIRM_FINAL_REMINDER_KEY] = [{ tenant_id: 't2', tenant_name: 'Clínica Dois', owner_email: 'dois@x.test' }]

    await run()

    expect(getUrlMock).toHaveBeenCalledWith('dois@x.test', MIN_LINK_VALIDITY_MS)
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
