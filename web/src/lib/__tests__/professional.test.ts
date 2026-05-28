import { describe, it, expect } from 'vitest'
import { isSignatureBlockComplete } from '../professional'

describe('isSignatureBlockComplete', () => {
  it('returns true when all fields present', () => {
    expect(
      isSignatureBlockComplete({
        signatureData: 'data:image/png;base64,xxx',
        registryType: 'CRM',
        registryNumber: '123456',
        registryState: 'SP',
      }),
    ).toBe(true)
  })

  it('returns false when signature missing', () => {
    expect(
      isSignatureBlockComplete({
        signatureData: null,
        registryType: 'CRM',
        registryNumber: '123456',
        registryState: 'SP',
      }),
    ).toBe(false)
  })

  it('returns false when any registry field missing', () => {
    expect(
      isSignatureBlockComplete({
        signatureData: 'x',
        registryType: 'CRM',
        registryNumber: null,
        registryState: 'SP',
      }),
    ).toBe(false)
  })
})
