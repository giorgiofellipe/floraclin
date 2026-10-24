import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))

import { LIFECYCLE_MESSAGES } from '@/lib/lifecycle-messages'
import { GET, POST } from '../route'

const SECRET = 'test-cron-secret'
const TOKEN = 'test-meta-token-xyz'
const WABA = 'waba-1'
const DISCORD = 'https://discord.test/webhook'
const NAMES = ['trial_last_day_click', 'trial_ending_soon_click', 'trial_winback_click', 'trial_help_click', 'trial_final_click']
const RETIRED = 'trial_ending_click'

type Row = { id: string; name: string; status: string; category: string; language: string; rejected_reason?: string }

// Fake Meta: templates on the WABA, plus names whose lookup/create/delete fail.
let onMeta: Map<string, Row>
let failLookup: Set<string>
let failCreate: Set<string>
let failDelete: boolean
let recategorizeAs: string | null
let fetchMock: ReturnType<typeof vi.fn>

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const metaError = (message: string) => json({ error: { message, code: 100 } }, 400)

function fakeFetch(input: string | URL | Request, init?: RequestInit) {
  const url = new URL(String(input))
  const method = init?.method ?? 'GET'
  if (url.href === DISCORD) return Promise.resolve(json({}))
  if (!url.pathname.endsWith(`/${WABA}/message_templates`)) throw new Error(`unexpected ${url.href}`)
  const name = url.searchParams.get('name') ?? ''
  if (method === 'GET') {
    if (failLookup.has(name)) return Promise.resolve(metaError(`lookup broke ${TOKEN}`))
    // Meta's `name` is a prefix filter: return every name that starts with it, in any language.
    const rows = [...onMeta.values()].filter((r) => r.name.startsWith(name))
    return Promise.resolve(json({ data: rows }))
  }
  if (method === 'POST') {
    const def = JSON.parse(String(init?.body))
    if (failCreate.has(def.name)) return Promise.resolve(metaError('create broke'))
    onMeta.set(def.name, { id: `id-${def.name}`, name: def.name, status: 'PENDING', category: def.category, language: def.language })
    const category = recategorizeAs ?? def.category
    onMeta.set(def.name, { ...onMeta.get(def.name)!, category })
    return Promise.resolve(json({ id: `id-${def.name}`, status: 'PENDING', ...(recategorizeAs && { category }) }))
  }
  if (method === 'DELETE') {
    if (failDelete) return Promise.resolve(metaError('delete broke'))
    onMeta.delete(name)
    return Promise.resolve(json({ success: true }))
  }
  throw new Error(`unexpected ${method}`)
}

const row = (name: string, status = 'APPROVED'): Row => ({
  id: `id-${name}`, name, status, category: 'MARKETING', language: 'pt_BR', rejected_reason: 'NONE',
})
const run = (auth = `Bearer ${SECRET}`) =>
  GET(new Request('http://localhost/x', { headers: { authorization: auth } }))
const calls = (method: string) =>
  fetchMock.mock.calls.filter(([url, init]) => String(url) !== DISCORD && (init?.method ?? 'GET') === method)
const discordCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === DISCORD)
const createdNames = () => calls('POST').map(([, init]) => JSON.parse(String(init.body)).name)
let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-24T15:30:00Z'))
  process.env.CRON_SECRET = SECRET
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test'
  process.env.FLORACLIN_WA_PHONE_NUMBER_ID = 'phone-1'
  process.env.FLORACLIN_WA_ACCESS_TOKEN = TOKEN
  process.env.FLORACLIN_WA_BUSINESS_ACCOUNT_ID = WABA
  process.env.DISCORD_WEBHOOK_LOGS = DISCORD
  onMeta = new Map()
  failLookup = new Set()
  failCreate = new Set()
  failDelete = false
  recategorizeAs = null
  fetchMock = vi.fn(fakeFetch)
  vi.stubGlobal('fetch', fetchMock)
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('one-off provision trial templates', () => {
  it('rejects a missing or wrong bearer, and any bearer when CRON_SECRET is unset', async () => {
    expect((await run('Bearer nope')).status).toBe(401)
    expect((await GET(new Request('http://localhost/x'))).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await run('Bearer ')).status).toBe(401)
    expect((await run('Bearer undefined')).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails with 500 when NEXT_PUBLIC_APP_URL is missing, before touching Meta', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    expect((await run()).status).toBe(500)
    expect(errorSpy).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['http://app.example.test', 'https'],
    ['https://localhost:3000', 'localhost'],
    ['https://127.0.0.1', 'localhost'],
    ['not a url', 'valid URL'],
  ])('fails with 500 when NEXT_PUBLIC_APP_URL is %s, before touching Meta', async (appUrl, reason) => {
    process.env.NEXT_PUBLIC_APP_URL = appUrl
    const res = await run()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain(reason)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('strips trailing slashes from NEXT_PUBLIC_APP_URL in the button URL', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test//'
    await run()
    for (const [, init] of calls('POST')) {
      const def = JSON.parse(String(init.body))
      expect(def.components.find((c: { type: string }) => c.type === 'BUTTONS').buttons[0].url).toBe(
        'https://app.example.test/api/lifecycle/click?lc={{1}}',
      )
    }
  })

  it('fails with 500 and touches no Meta endpoint when a trial message has an unexpected template name', async () => {
    const message = LIFECYCLE_MESSAGES.find((m) => m.key === 'trial_help') as { templateName: string }
    const original = message.templateName
    message.templateName = 'trial_help_v2'
    try {
      expect((await run()).status).toBe(500)
    } finally {
      message.templateName = original
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the result order when lookups resolve out of order', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const name = new URL(String(input)).searchParams.get('name')
      if (name === NAMES[0] && (init?.method ?? 'GET') === 'GET') await new Promise((r) => setTimeout(r, 20))
      return fakeFetch(input, init)
    })
    const body = await (await run()).json()
    expect(body.templates.map((t: { name: string }) => t.name)).toEqual(NAMES)
    expect(createdNames()[4]).toBe(NAMES[0])
  })

  it('reports the category Meta assigned to a created template', async () => {
    recategorizeAs = 'UTILITY'
    const body = await (await run()).json()
    expect(body.templates.every((t: { category: string }) => t.category === 'UTILITY')).toBe(true)
  })

  it('creates only the missing templates with the lifecycle definitions', async () => {
    onMeta.set(NAMES[0], row(NAMES[0]))
    onMeta.set(NAMES[3], row(NAMES[3], 'REJECTED'))
    // Prefix and language traps: neither counts as trial_winback_click existing.
    onMeta.set('trial_winback_click_v2', row('trial_winback_click_v2'))
    onMeta.set('x', { ...row(NAMES[2]), language: 'en_US' })

    const body = await (await run()).json()

    expect(createdNames()).toEqual([NAMES[1], NAMES[2], NAMES[4]])
    for (const [url, init] of calls('POST')) {
      expect(String(url)).toBe(`https://graph.facebook.com/v21.0/${WABA}/message_templates`)
      const def = JSON.parse(String(init.body))
      expect(def).toMatchObject({ language: 'pt_BR', category: 'MARKETING' })
      expect(def.components.find((c: { type: string }) => c.type === 'BUTTONS').buttons[0].url).toBe(
        'https://app.example.test/api/lifecycle/click?lc={{1}}',
      )
    }
    expect(body.templates.map((t: { name: string; action: string }) => [t.name, t.action])).toEqual([
      [NAMES[0], 'exists'],
      [NAMES[1], 'created'],
      [NAMES[2], 'created'],
      [NAMES[3], 'exists'],
      [NAMES[4], 'created'],
    ])
    expect(body.templates[3]).toMatchObject({ id: `id-${NAMES[3]}`, status: 'REJECTED', category: 'MARKETING', rejectedReason: 'NONE' })
    expect(body.templates[1]).toMatchObject({ id: `id-${NAMES[1]}`, status: 'PENDING', category: 'MARKETING' })
  })

  it('a second run only reports status', async () => {
    await run()
    expect(calls('POST')).toHaveLength(5)
    fetchMock.mockClear()
    const body = await (await run()).json()
    expect(calls('POST')).toHaveLength(0)
    expect(body.templates.every((t: { action: string; status: string }) => t.action === 'exists' && t.status === 'PENDING')).toBe(true)
  })

  it('deletes trial_ending_click only when it exists', async () => {
    let body = await (await run()).json()
    expect(body.retired).toEqual({ name: RETIRED, action: 'absent' })
    expect(calls('DELETE')).toHaveLength(0)

    onMeta.set(RETIRED, row(RETIRED))
    // Close to trial_ending_soon_click (same `trial_ending_` stem, though neither name is a prefix
    // of the other); the delete must name the retired one only.
    body = await (await run()).json()
    expect(body.retired).toEqual({ name: RETIRED, action: 'deleted' })
    expect(calls('DELETE')).toHaveLength(1)
    expect(new URL(String(calls('DELETE')[0][0])).searchParams.get('name')).toBe(RETIRED)
    expect(onMeta.has(NAMES[1])).toBe(true)

    fetchMock.mockClear()
    body = await (await run()).json()
    expect(body.retired.action).toBe('absent')
    expect(calls('DELETE')).toHaveLength(0)
  })

  it.each(['PENDING_DELETION', 'DELETED'])('treats trial_ending_click in %s as absent', async (status) => {
    onMeta.set(RETIRED, row(RETIRED, status))
    const body = await (await run()).json()
    expect(body.retired).toEqual({ name: RETIRED, action: 'absent' })
    expect(calls('DELETE')).toHaveLength(0)
  })

  it('reports a failed delete', async () => {
    onMeta.set(RETIRED, row(RETIRED))
    failDelete = true
    const body = await (await run()).json()
    expect(body.retired).toMatchObject({ action: 'delete_failed', error: 'Meta API error: delete broke | code=100' })
  })

  it('a per-template failure does not abort the others, and no token reaches the output', async () => {
    failLookup.add(NAMES[1])
    failCreate.add(NAMES[2])
    const res = await run()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.templates.map((t: { action: string }) => t.action)).toEqual([
      'created', 'lookup_failed', 'create_failed', 'created', 'created',
    ])
    expect(body.templates[1].error).toContain('[redacted]')
    expect(body.templates[2].error).toBe('Meta API error: create broke | code=100')

    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy.mock.calls[0][0]).toBe('[oneoff-provision-trial-templates]')
    expect(JSON.parse(logSpy.mock.calls[0][1] as string)).toEqual(body)
    const output = JSON.stringify([logSpy.mock.calls, errorSpy.mock.calls, body, discordCalls()])
    expect(output).not.toContain(TOKEN)
    expect(output).not.toContain('Bearer')
  })

  describe('Discord', () => {
    const allExist = () => [...NAMES].forEach((name) => onMeta.set(name, row(name)))

    it('posts when something was created', async () => {
      await run()
      expect(discordCalls()).toHaveLength(1)
      expect(JSON.parse(String(discordCalls()[0][1].body)).content).toContain(
        `${NAMES[0]} [id-${NAMES[0]}]: PENDING MARKETING (created)`,
      )
    })

    it('includes id, category and a rejected reason other than NONE', async () => {
      allExist()
      onMeta.set(NAMES[1], { ...row(NAMES[1], 'REJECTED'), rejected_reason: 'INVALID_FORMAT' })
      failLookup.add(NAMES[2])
      vi.setSystemTime(new Date('2026-10-24T16:05:00Z'))
      await run()
      const content = JSON.parse(String(discordCalls()[0][1].body)).content
      expect(content).toContain(`${NAMES[0]} [id-${NAMES[0]}]: APPROVED MARKETING (exists)`)
      expect(content).toContain(`${NAMES[1]} [id-${NAMES[1]}]: REJECTED MARKETING (exists, INVALID_FORMAT)`)
      expect(content).toContain(`${NAMES[2]} [?]: ? ? (lookup_failed)`)
      expect(content).not.toContain('NONE')
    })

    it('warns with the status only when the webhook answers non-2xx', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      fetchMock.mockImplementation((input, init) =>
        String(input) === DISCORD ? Promise.resolve(json({}, 429)) : fakeFetch(input, init))
      expect((await run()).status).toBe(200)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0]).toEqual(['[oneoff-provision-trial-templates]', 'Discord webhook returned HTTP 429'])
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(DISCORD)
    })

    it('posts when the retired template was deleted', async () => {
      allExist()
      onMeta.set(RETIRED, row(RETIRED))
      await run()
      expect(discordCalls()).toHaveLength(1)
    })

    it('reports failures only inside the hourly window', async () => {
      allExist()
      failLookup.add(NAMES[0])
      failCreate.add(NAMES[1])
      onMeta.delete(NAMES[1])
      onMeta.set(RETIRED, row(RETIRED))
      failDelete = true
      await run()
      expect(discordCalls()).toHaveLength(0)
      vi.setSystemTime(new Date('2026-10-24T16:14:59Z'))
      await run()
      expect(discordCalls()).toHaveLength(1)
    })

    it('stays quiet on an unchanged run outside the hourly window, posts inside it', async () => {
      allExist()
      await run()
      expect(discordCalls()).toHaveLength(0)
      vi.setSystemTime(new Date('2026-10-24T16:05:00Z'))
      await run()
      expect(discordCalls()).toHaveLength(1)
    })

    it('is a no-op without a webhook, and a Discord failure does not fail the run', async () => {
      delete process.env.DISCORD_WEBHOOK_LOGS
      await run()
      expect(discordCalls()).toHaveLength(0)

      process.env.DISCORD_WEBHOOK_LOGS = DISCORD
      fetchMock.mockImplementation((input, init) =>
        String(input) === DISCORD ? Promise.reject(new Error('down')) : fakeFetch(input, init))
      onMeta.clear()
      expect((await run()).status).toBe(200)
    })
  })

  it('POST behaves like GET', async () => {
    const res = await POST(new Request('http://localhost/x', { method: 'POST', headers: { authorization: `Bearer ${SECRET}` } }))
    expect(res.status).toBe(200)
    expect(calls('POST')).toHaveLength(5)
  })
})
