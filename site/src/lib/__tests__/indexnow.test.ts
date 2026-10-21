import { describe, it, expect } from 'vitest'
import { indexNowKey } from '@/lib/indexnow'

describe('indexNowKey', () => {
  it('is off when the variable is unset or blank', () => {
    expect(indexNowKey(undefined)).toBeNull()
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
