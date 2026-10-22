import { describe, expect, it } from 'vitest'
import { clientIpKey, createRateLimiter } from '../rate-limit'

describe('createRateLimiter', () => {
  it('allows `limit` requests per window per key, then refuses until the window resets', () => {
    const rl = createRateLimiter({ limit: 2, windowMs: 1000 })
    expect([rl.take('a', 0), rl.take('a', 10), rl.take('a', 20)]).toEqual([true, true, false])
    expect(rl.take('b', 20)).toBe(true) // other keys are independent
    expect(rl.take('a', 1000)).toBe(true) // new window
  })
})

describe('clientIpKey', () => {
  it('takes the first forwarded hop, then x-real-ip', () => {
    expect(clientIpKey(new Headers({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }))).toBe('1.1.1.1')
    expect(clientIpKey(new Headers({ 'x-real-ip': '3.3.3.3' }))).toBe('3.3.3.3')
    expect(clientIpKey(new Headers())).toBe('unknown')
  })
})
