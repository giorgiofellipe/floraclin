import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(async () => ({
    id: 'tenant-1',
    settings: {
      whatsapp_enabled: true,
      whatsapp_phone_number_id: 'phone-id',
      whatsapp_access_token: 'access-token',
      whatsapp_business_account_id: 'biz-id',
    },
  })),
}))

import { verifyWebhookSignature, sendMediaMessage } from '../whatsapp'

describe('verifyWebhookSignature', () => {
  it('returns true for valid signature', () => {
    const secret = 'test-secret'
    const payload = '{"test":"data"}'
    const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    expect(verifyWebhookSignature(payload, `sha256=${hmac}`, secret)).toBe(true)
  })

  it('returns false for invalid signature', () => {
    const secret = 'test-secret'
    const payload = '{"test":"data"}'
    const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    // Replace last char to make it invalid but same length
    const invalidHmac = hmac.slice(0, -1) + (hmac.slice(-1) === '0' ? '1' : '0')
    expect(verifyWebhookSignature(payload, `sha256=${invalidHmac}`, secret)).toBe(false)
  })

  it('returns false for mismatched length signature', () => {
    expect(verifyWebhookSignature('payload', 'sha256=short', 'secret')).toBe(false)
  })
})

describe('sendMediaMessage', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ messages: [{ id: 'wamid.123' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('includes filename in document payload when provided', async () => {
    await sendMediaMessage(
      'tenant-1',
      '+5511999999999',
      'document',
      'https://example.com/doc.pdf',
      'Receita - João',
      'receita-joao.pdf',
    )
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((call[1] as RequestInit).body as string)
    expect(body.document).toEqual({
      link: 'https://example.com/doc.pdf',
      caption: 'Receita - João',
      filename: 'receita-joao.pdf',
    })
  })

  it('omits filename for non-document media types', async () => {
    await sendMediaMessage(
      'tenant-1',
      '+5511999999999',
      'image',
      'https://example.com/img.jpg',
      undefined,
      'should-be-ignored.jpg',
    )
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((call[1] as RequestInit).body as string)
    expect(body.image).toEqual({ link: 'https://example.com/img.jpg' })
    expect(body.image.filename).toBeUndefined()
  })

  it('omits filename when not provided for a document', async () => {
    await sendMediaMessage(
      'tenant-1',
      '+5511999999999',
      'document',
      'https://example.com/doc.pdf',
    )
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((call[1] as RequestInit).body as string)
    expect(body.document).toEqual({ link: 'https://example.com/doc.pdf' })
  })
})
