import { describe, it, expect } from 'vitest'
import { closePackageSchema, closeReasonLabels, closeReasonValues } from '../encerrar-pacote'

describe('closePackageSchema', () => {
  it('accepts patient_lost_expiry with empty note', () => {
    const result = closePackageSchema.safeParse({
      closedReason: 'patient_lost_expiry',
      closeNote: '',
    })
    expect(result.success).toBe(true)
  })

  it('accepts patient_lost_expiry with missing note (default applies)', () => {
    const result = closePackageSchema.safeParse({
      closedReason: 'patient_lost_expiry',
    })
    expect(result.success).toBe(true)
  })

  it('accepts patient_stopped_treatment with empty note', () => {
    const result = closePackageSchema.safeParse({
      closedReason: 'patient_stopped_treatment',
      closeNote: '',
    })
    expect(result.success).toBe(true)
  })

  it('rejects "other" reason with an empty note', () => {
    const result = closePackageSchema.safeParse({
      closedReason: 'other',
      closeNote: '',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['closeNote'])
    }
  })

  it('rejects "other" reason with whitespace-only note', () => {
    const result = closePackageSchema.safeParse({
      closedReason: 'other',
      closeNote: '   \n\t  ',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['closeNote'])
    }
  })

  it('accepts "other" reason with a non-empty note', () => {
    const result = closePackageSchema.safeParse({
      closedReason: 'other',
      closeNote: 'Paciente mudou de cidade.',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown reason string', () => {
    const result = closePackageSchema.safeParse({
      closedReason: 'paciente_desistiu',
      closeNote: 'Foi embora',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a note longer than 1000 chars', () => {
    const result = closePackageSchema.safeParse({
      closedReason: 'other',
      closeNote: 'x'.repeat(1001),
    })
    expect(result.success).toBe(false)
  })
})

describe('closeReasonLabels', () => {
  it('has a Portuguese label for every closeReasonValues entry', () => {
    for (const value of closeReasonValues) {
      const label = closeReasonLabels[value]
      expect(label).toBeTruthy()
      expect(typeof label).toBe('string')
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('has exactly one label per reason value (no extras)', () => {
    expect(Object.keys(closeReasonLabels).sort()).toEqual([...closeReasonValues].sort())
  })
})
