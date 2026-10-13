import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendPlatformTemplate } from '../platform-whatsapp'

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
})
