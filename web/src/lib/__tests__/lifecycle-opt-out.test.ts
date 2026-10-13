import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ db: {} }))

import { lifecycleOptOutUrl, isValidLifecycleOptOut } from '../lifecycle-opt-out'

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'

function signatureOf(tenantId: string): string {
  return new URL(lifecycleOptOutUrl(tenantId)).searchParams.get('s')!
}

describe('lifecycle opt-out signature', () => {
  beforeEach(() => {
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')
  })

  it('accepts the signature issued for the same tenant', () => {
    expect(isValidLifecycleOptOut(TENANT_A, signatureOf(TENANT_A))).toBe(true)
  })

  it('rejects a signature issued for another tenant (anyone could opt out any clinic)', () => {
    expect(isValidLifecycleOptOut(TENANT_B, signatureOf(TENANT_A))).toBe(false)
  })

  it('returns false for a truncated signature instead of throwing', () => {
    const truncated = signatureOf(TENANT_A).slice(0, 10)
    expect(isValidLifecycleOptOut(TENANT_A, truncated)).toBe(false)
  })
})
