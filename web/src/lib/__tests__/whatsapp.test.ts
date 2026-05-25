import { describe, it, expect } from 'vitest'
import { verifyWebhookSignature } from '../whatsapp'
import crypto from 'crypto'

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
