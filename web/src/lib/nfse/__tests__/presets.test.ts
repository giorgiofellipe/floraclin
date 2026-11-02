import { describe, expect, it } from 'vitest'
import { NFSE_SERVICE_PRESETS, resolveServiceCodes } from '../presets'

describe('resolveServiceCodes', () => {
  it('resolves from a preset', () => {
    expect(resolveServiceCodes({ servicePreset: 'odontologia', advancedCodes: null })).toEqual({
      cTribNac: '041201',
      cNBS: '123012300',
      tribISSQN: 1,
      cIndOp: '100301',
      CST: '000',
      cClassTrib: '000001',
    })
  })

  it('prefers the preset over advanced codes', () => {
    const advanced = { ...NFSE_SERVICE_PRESETS.medicina, cTribNac: '999999' }
    expect(resolveServiceCodes({ servicePreset: 'medicina', advancedCodes: advanced }).cTribNac).toBe('040101')
  })

  it('throws when no preset and no codes', () => {
    expect(() => resolveServiceCodes({ servicePreset: null, advancedCodes: null })).toThrow()
  })
})
