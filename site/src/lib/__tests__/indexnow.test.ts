import { describe, it, expect, vi, afterEach } from 'vitest'
import { indexNowKey } from '@/lib/indexnow'

describe('indexNowKey', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is off when the variable is unset or blank', () => {
    vi.stubEnv('INDEXNOW_KEY', undefined)
    expect(indexNowKey()).toBeNull()
    expect(indexNowKey('   ')).toBeNull()
  })

  it('rejects values that are not a valid IndexNow key', () => {
    expect(indexNowKey('short')).toBeNull()
    expect(indexNowKey('../../etc/passwd')).toBeNull()
  })

  it('accepts a 32-char hex key and trims it', () => {
    expect(indexNowKey(' 0123456789abcdef0123456789abcdef\n')).toBe('0123456789abcdef0123456789abcdef')
  })
})
