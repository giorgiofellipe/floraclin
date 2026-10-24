import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { findPlatformTemplate, sendPlatformTemplate } from '../platform-whatsapp'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('FLORACLIN_WA_PHONE_NUMBER_ID', 'phone-1')
  vi.stubEnv('FLORACLIN_WA_ACCESS_TOKEN', 'token-1')
  vi.stubEnv('FLORACLIN_WA_BUSINESS_ACCOUNT_ID', 'waba-1')
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

describe('sendPlatformTemplate', () => {
  it('throws WHATSAPP_NOT_CONFIGURED before any network call when env is missing', async () => {
    vi.stubEnv('FLORACLIN_WA_ACCESS_TOKEN', '')
    await expect(sendPlatformTemplate('5511999999999', 'welcome', [])).rejects.toMatchObject({
      code: 'WHATSAPP_NOT_CONFIGURED',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces the Meta error message and code when the API rejects the send', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { message: 'Template name does not exist', code: 132001 } }, 400),
    )
    await expect(sendPlatformTemplate('5511999999999', 'welcome', [])).rejects.toThrow(
      'Meta API error: Template name does not exist | code=132001',
    )
  })

  it('throws on a 2xx without a message id so the send is never recorded as sent', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ messaging_product: 'whatsapp', messages: [] }))
    await expect(sendPlatformTemplate('5511999999999', 'welcome', [])).rejects.toThrow(
      'Meta API error: missing message id',
    )
  })

  it('returns the message id and omits components when there are no body params', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ messages: [{ id: 'wamid.ABC' }] }))
    const result = await sendPlatformTemplate('5511999999999', 'welcome', [])
    expect(result).toEqual({ metaMessageId: 'wamid.ABC' })
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.template).toEqual({ name: 'welcome', language: { code: 'pt_BR' } })
  })

  it('sends body params as text parameters in order', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ messages: [{ id: 'wamid.ABC' }] }))
    await sendPlatformTemplate('5511999999999', 'nudge', ['Ana', 'Clínica Flor'])
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.template.components).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Ana' },
          { type: 'text', text: 'Clínica Flor' },
        ],
      },
    ])
  })

  it('sends dynamic URL button params as button components', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ messages: [{ id: 'wamid.ABC' }] }))
    await sendPlatformTemplate('5511999999999', 'trial_welcome_click', ['Ana'], {
      buttonUrlParams: ['send-1'],
    })

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.template.components).toEqual([
      {
        type: 'body',
        parameters: [{ type: 'text', text: 'Ana' }],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: 'send-1' }],
      },
    ])
  })
})

describe('findPlatformTemplate', () => {
  const row = (name: string, language: string, status = 'APPROVED') => ({
    id: `id-${name}-${language}`,
    name,
    language,
    status,
    category: 'MARKETING',
  })

  it('queries the WABA by name with the bearer token and returns the exact pt_BR match', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          row('trial_final_v2', 'pt_BR'),
          row('trial_final', 'en_US'),
          { ...row('trial_final', 'pt_BR', 'REJECTED'), rejected_reason: 'INVALID_FORMAT' },
        ],
      }),
    )

    const result = await findPlatformTemplate('trial_final')

    expect(result).toEqual({
      id: 'id-trial_final-pt_BR',
      name: 'trial_final',
      status: 'REJECTED',
      category: 'MARKETING',
      rejectedReason: 'INVALID_FORMAT',
    })
    const [url, init] = fetchMock.mock.calls[0]
    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/v21.0/waba-1/message_templates')
    expect(parsed.searchParams.get('name')).toBe('trial_final')
    expect(parsed.searchParams.get('fields')).toBe('id,name,status,category,language,rejected_reason')
    expect(parsed.searchParams.get('limit')).toBe('100')
    expect(init.headers).toEqual({ Authorization: 'Bearer token-1' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('returns null when only prefix matches or other languages exist', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [row('trial_final_v2', 'pt_BR'), row('trial_final', 'en_US')] }))
    expect(await findPlatformTemplate('trial_final')).toBeNull()
  })

  it('falls back to empty strings and a null reason when id, category or rejected_reason are not strings', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: [{ ...row('trial_final', 'pt_BR'), id: 42, category: null, rejected_reason: 7 }] }),
    )

    expect(await findPlatformTemplate('trial_final')).toEqual({
      id: '',
      name: 'trial_final',
      status: 'APPROVED',
      category: '',
      rejectedReason: null,
    })
  })

  it('throws on a 2xx whose body is not valid JSON so the status reads as unknown, not missing', async () => {
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 200 }))
    await expect(findPlatformTemplate('trial_final')).rejects.toThrow('Meta API error: unexpected response')
  })

  it('throws on a 2xx without a data array', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ paging: {} }))
    await expect(findPlatformTemplate('trial_final')).rejects.toThrow('Meta API error: unexpected response')
  })

  it('throws when the exact pt_BR match has no string status', async () => {
    const { status: _status, ...withoutStatus } = row('trial_final', 'pt_BR')
    fetchMock.mockResolvedValue(jsonResponse({ data: [withoutStatus] }))
    await expect(findPlatformTemplate('trial_final')).rejects.toThrow('Meta API error: unexpected response')
  })

  it('throws the Meta error without leaking the access token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'Invalid OAuth access token', code: 190 } }, 401))

    const error = await findPlatformTemplate('trial_final').catch((e: Error) => e)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Meta API error: Invalid OAuth access token | code=190')
    expect((error as Error).message).not.toContain('token-1')
  })

  it('throws WHATSAPP_NOT_CONFIGURED before any network call when env is missing', async () => {
    vi.stubEnv('FLORACLIN_WA_BUSINESS_ACCOUNT_ID', '')
    await expect(findPlatformTemplate('trial_final')).rejects.toMatchObject({ code: 'WHATSAPP_NOT_CONFIGURED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
