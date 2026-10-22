import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { rows, owners } = vi.hoisted(() => ({ rows: { value: [] as unknown[] }, owners: { value: [] as unknown[] } }))

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))
vi.mock('@/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => rows.value,
        innerJoin: () => ({ where: () => ({ orderBy: async () => owners.value }) }),
      }),
    }),
  },
}))
vi.mock('@/db/queries/lifecycle', () => ({
  claimLifecycleSend: vi.fn(),
  finishLifecycleSend: vi.fn(),
  recordSkippedLifecycleSend: vi.fn(),
}))
vi.mock('@/lib/platform-whatsapp', () => ({
  createPlatformTemplate: vi.fn(),
  findPlatformTemplate: vi.fn(),
  sendPlatformTemplate: vi.fn(),
}))

import { claimLifecycleSend, finishLifecycleSend, recordSkippedLifecycleSend } from '@/db/queries/lifecycle'
import { createPlatformTemplate, findPlatformTemplate, sendPlatformTemplate } from '@/lib/platform-whatsapp'
import { GET, POST } from '../route'

const SECRET = 'test-secret'
const IDS = [
  '9a58b646-242d-47c7-b865-824a89fdbd79', 'b2c47582-c44f-4148-b43d-2643a1db2830',
  '092c7203-558f-4a16-9969-c58caf165230', 'a47a9b46-d9df-4cef-845f-aadede3f6d05',
  'ec2b6ea4-82df-45f5-b483-156a83bac523', '6efe2536-5969-41b7-9640-14f8c6e6589e',
  'e15908a9-2518-4684-b90f-21c39486b82b', '68ae595d-12b8-47dd-9866-b613f1698c56',
  '2881ebd9-f176-4d93-83d9-d1f43e68935a',
]
const approved = { id: 't1', name: 'google_signup_fix_click', status: 'APPROVED', category: 'UTILITY', rejectedReason: 'NONE' }

const post = (action: string, auth = `Bearer ${SECRET}`) =>
  POST(new Request('http://localhost/x', { method: 'POST', headers: { authorization: auth }, body: JSON.stringify({ action }) }))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 })
  vi.setSystemTime(new Date('2026-10-22T20:00:00Z'))
  process.env.CRON_SECRET = SECRET
  rows.value = IDS.map((id, i) => ({ id, phone: `(11) 9${String(i).repeat(4)}-12${i}${i}`, deletedAt: null, optedOutAt: null }))
  const names = ['Daniele Souza', 'Leticia Lima', 'Kauane', 'Priscila', 'Jessica', 'João', 'Adrielle', 'Leidimar', 'Maycon']
  owners.value = IDS.map((tenantId, i) => ({ tenantId, fullName: names[i] }))
  vi.mocked(findPlatformTemplate).mockResolvedValue(approved)
  vi.mocked(claimLifecycleSend).mockImplementation(async ({ tenantId }) => `claim-${tenantId}`)
  vi.mocked(sendPlatformTemplate).mockImplementation(async (to) => ({ metaMessageId: `wamid.${to.slice(-4)}` }))
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

async function sendAll(res: Promise<Response>) {
  await vi.runAllTimersAsync()
  return res
}

describe('one-off google signup fix', () => {
  it('rejects a missing or wrong bearer', async () => {
    expect((await post('status', 'Bearer nope')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await post('status', 'Bearer ')).status).toBe(401)
    expect(findPlatformTemplate).not.toHaveBeenCalled()
  })

  it('create is idempotent', async () => {
    const body = await (await post('create')).json()
    expect(body.created).toBe(false)
    expect(createPlatformTemplate).not.toHaveBeenCalled()

    vi.mocked(findPlatformTemplate).mockResolvedValueOnce(null).mockResolvedValueOnce({ ...approved, status: 'PENDING' })
    const created = await (await post('create')).json()
    expect(created.created).toBe(true)
    const def = vi.mocked(createPlatformTemplate).mock.calls[0][0]
    expect(def).toMatchObject({ name: 'google_signup_fix_click', category: 'UTILITY', language: 'pt_BR' })
  })

  it.each([
    { ...approved, status: 'PENDING' },
    { ...approved, status: 'REJECTED' },
    { ...approved, category: 'MARKETING' },
    null,
  ])('refuses to send unless APPROVED as UTILITY (%o)', async (template) => {
    vi.mocked(findPlatformTemplate).mockResolvedValue(template)
    const body = await (await post('send')).json()
    expect(body.sent).toBe(false)
    expect(claimLifecycleSend).not.toHaveBeenCalled()
    expect(sendPlatformTemplate).not.toHaveBeenCalled()
  })

  it('refuses after the deadline', async () => {
    vi.setSystemTime(new Date('2026-10-23T00:00:00Z'))
    expect((await (await post('send')).json()).reason).toBe('past_deadline')
    expect(sendPlatformTemplate).not.toHaveBeenCalled()
  })

  it('claims before sending, sends each of the 9 once and stores the wamid', async () => {
    const body = await (await sendAll(post('send'))).json()
    expect(sendPlatformTemplate).toHaveBeenCalledTimes(9)
    const firstClaim = vi.mocked(claimLifecycleSend).mock.invocationCallOrder[0]
    expect(firstClaim).toBeLessThan(vi.mocked(sendPlatformTemplate).mock.invocationCallOrder[0])
    expect(vi.mocked(claimLifecycleSend).mock.calls[0][0]).toMatchObject({ messageKey: 'google_signup_fix', channel: 'whatsapp', recipient: '5511900001200' })
    expect(vi.mocked(sendPlatformTemplate).mock.calls[1]).toEqual(['5511911111211', 'google_signup_fix_click', ['Leticia']])
    expect(finishLifecycleSend).toHaveBeenCalledWith(`claim-${IDS[0]}`, { status: 'sent', metaMessageId: 'wamid.1200' })
    expect(body.results).toHaveLength(9)
    expect(body.results[0]).toEqual({ tenantId: IDS[0], firstName: 'Daniele', phoneLast4: '1200', result: 'sent', wamid: 'wamid.1200' })
    expect(JSON.stringify(body)).not.toMatch(/55119\d{8}/)
  })

  it('skips already-claimed, opted-out, deleted and invalid phones; records failures as failed', async () => {
    rows.value = (rows.value as Array<Record<string, unknown>>).map((r, i) =>
      i === 1 ? { ...r, optedOutAt: new Date() } : i === 2 ? { ...r, deletedAt: new Date() } : i === 3 ? { ...r, phone: '123' } : r)
    vi.mocked(claimLifecycleSend).mockImplementation(async ({ tenantId }) => (tenantId === IDS[0] ? null : `claim-${tenantId}`))
    vi.mocked(sendPlatformTemplate).mockImplementation(async (to) => {
      if (to.endsWith('1244')) throw new Error('Meta API error: bad | code=131026')
      return { metaMessageId: `wamid.${to.slice(-4)}` }
    })
    const body = await (await sendAll(post('send'))).json()
    const byName = Object.fromEntries(body.results.map((r: { firstName: string }) => [r.firstName, r]))
    expect(byName.Daniele.result).toBe('already_claimed')
    expect(byName.Leticia.reason).toBe('opted_out')
    expect(byName.Kauane.reason).toBe('deleted')
    expect(byName.Priscila.reason).toBe('invalid_phone')
    expect(recordSkippedLifecycleSend).toHaveBeenCalledTimes(1)
    expect(byName.Jessica).toMatchObject({ result: 'failed', errorCode: '131026' })
    expect(finishLifecycleSend).toHaveBeenCalledWith(`claim-${IDS[4]}`, { status: 'failed', error: 'Meta API error: bad | code=131026' })
    expect(sendPlatformTemplate).toHaveBeenCalledTimes(5)
  })

  it('keeps a Meta-accepted send as sent when the row update fails, and survives DB errors', async () => {
    vi.mocked(finishLifecycleSend).mockImplementation(async (id) => {
      if (id === `claim-${IDS[0]}`) throw new Error('db down')
    })
    vi.mocked(claimLifecycleSend).mockImplementation(async ({ tenantId }) => {
      if (tenantId === IDS[1]) throw new Error('db down')
      return `claim-${tenantId}`
    })
    const body = await (await sendAll(post('send'))).json()
    expect(body.results[0]).toMatchObject({ result: 'sent', wamid: 'wamid.1200', recordError: true })
    expect(body.results[1]).toMatchObject({ result: 'failed', errorCode: 'db:Error' })
    expect(body.results.filter((r: { result: string }) => r.result === 'sent')).toHaveLength(8)
  })

  it('GET (cron) creates when missing and only sends once approved', async () => {
    vi.mocked(findPlatformTemplate).mockResolvedValueOnce(null).mockResolvedValueOnce({ ...approved, status: 'PENDING' })
    const get = () => GET(new Request('http://localhost/x', { headers: { authorization: `Bearer ${SECRET}` } }))
    expect((await (await get()).json()).created).toBe(true)
    vi.mocked(findPlatformTemplate).mockResolvedValueOnce({ ...approved, status: 'PENDING' })
    await get()
    expect(sendPlatformTemplate).not.toHaveBeenCalled()
    await sendAll(get())
    expect(sendPlatformTemplate).toHaveBeenCalledTimes(9)
  })
})
