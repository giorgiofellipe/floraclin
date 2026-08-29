import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { postEvents } from '../capi-client'
import type { MetaEventPayload } from '../types'

const target = { datasetId: '123', accessToken: 'tok' }

function makeEvent(overrides: Partial<MetaEventPayload> = {}): MetaEventPayload {
  return {
    event_name: 'Lead',
    event_time: 1756400000,
    event_id: 'lead:abc',
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: { ctwa_clid: 'clid-1' },
    ...overrides,
  }
}

describe('postEvents', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('posts to the dataset events endpoint with the pinned graph version', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'tr-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await postEvents(target, [makeEvent()])

    expect(result).toEqual({ ok: true, eventsReceived: 1, fbTraceId: 'tr-1' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v21.0/123/events')
    expect(init?.method).toBe('POST')
    const body = JSON.parse(init?.body as string)
    expect(body.data).toHaveLength(1)
    expect(body.access_token).toBe('tok')
  })

  it('never puts the access token in the URL', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ events_received: 1 }), { status: 200 }),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    await postEvents(target, [makeEvent()])

    expect(fetchMock.mock.calls[0][0]).not.toContain('tok')
  })

  it('includes test_event_code only when the target carries one', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ events_received: 1 }), { status: 200 }),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    await postEvents({ ...target, testEventCode: 'TEST123' }, [makeEvent()])
    await postEvents({ ...target, testEventCode: null }, [makeEvent()])

    const withCode = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(withCode.test_event_code).toBe('TEST123')

    const withoutCode = JSON.parse(fetchMock.mock.calls[1][1]?.body as string)
    expect(withoutCode).not.toHaveProperty('test_event_code')
  })

  it('classifies an expired token as auth', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 190, message: 'expired' } }), {
        status: 401,
      }),
    ) as unknown as typeof fetch

    const result = await postEvents(target, [makeEvent()])

    expect(result).toEqual(expect.objectContaining({ ok: false, kind: 'auth' }))
  })

  it('classifies a rejected payload as invalid, which must not be retried', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 100, message: 'bad field' } }), {
        status: 400,
      }),
    ) as unknown as typeof fetch

    const result = await postEvents(target, [makeEvent()])

    expect(result).toEqual(expect.objectContaining({ ok: false, kind: 'invalid' }))
  })

  it('prefers error_user_msg over the generic message and keeps the raw fields', async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 100,
            message: 'Invalid parameter',
            error_subcode: 2804003,
            error_user_title: 'Parâmetro inválido',
            error_user_msg: 'user_data precisa conter ao menos um parâmetro de identificação.',
            fbtrace_id: 'A3ip2Ls_KK6lBhQHO3k079_',
          },
        }),
        { status: 400 },
      ),
    ) as unknown as typeof fetch

    const result = await postEvents(target, [makeEvent()])

    expect(result).toEqual({
      ok: false,
      kind: 'invalid',
      message: 'user_data precisa conter ao menos um parâmetro de identificação.',
      errorUserTitle: 'Parâmetro inválido',
      errorUserMsg: 'user_data precisa conter ao menos um parâmetro de identificação.',
      errorSubcode: 2804003,
      fbTraceId: 'A3ip2Ls_KK6lBhQHO3k079_',
    })
  })

  it('falls back to the generic message when Meta sends no error_user_msg', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 100, message: 'Invalid parameter' } }), {
        status: 400,
      }),
    ) as unknown as typeof fetch

    const result = await postEvents(target, [makeEvent()])

    expect(result).toEqual(
      expect.objectContaining({ ok: false, kind: 'invalid', message: 'Invalid parameter' }),
    )
  })

  it('classifies a 500 as transient', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'oops' } }), { status: 500 }),
    ) as unknown as typeof fetch

    const result = await postEvents(target, [makeEvent()])

    expect(result).toEqual(expect.objectContaining({ ok: false, kind: 'transient' }))
  })

  it('classifies a timeout as transient', async () => {
    global.fetch = vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'TimeoutError')
    }) as unknown as typeof fetch

    const result = await postEvents(target, [makeEvent()])

    expect(result).toEqual(expect.objectContaining({ ok: false, kind: 'transient' }))
  })

  it('classifies a thrown network error as transient', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    const result = await postEvents(target, [makeEvent()])

    expect(result).toEqual(
      expect.objectContaining({ ok: false, kind: 'transient', message: 'network down' }),
    )
  })
})
