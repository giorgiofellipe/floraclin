import { describe, expect, it } from 'vitest'
import { NFSE_SERVICE_PRESETS, resolveServiceCodes } from '../presets'

describe('resolveServiceCodes', () => {
  it('prefers the preset over advanced codes', () => {
    const advanced = { ...NFSE_SERVICE_PRESETS.medicina, cTribNac: '999999' }
    expect(resolveServiceCodes({ servicePreset: 'medicina', advancedCodes: advanced }).cTribNac).toBe('040101')
  })

  it('throws when no preset and no codes', () => {
    expect(() => resolveServiceCodes({ servicePreset: null, advancedCodes: null })).toThrow()
  })
})
