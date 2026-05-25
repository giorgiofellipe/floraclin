import { describe, it, expect } from 'vitest'
import {
  PROSPECT_STAGES,
  updateProspectSchema,
  convertProspectSchema,
  prospectFilterSchema,
} from '../prospect'

describe('PROSPECT_STAGES', () => {
  it('contains all 6 stages', () => {
    expect(PROSPECT_STAGES).toHaveLength(6)
  })

  it('includes expected stage values', () => {
    expect(PROSPECT_STAGES).toEqual([
      'novo',
      'contatado',
      'qualificado',
      'agendado',
      'convertido',
      'perdido',
    ])
  })
})

describe('updateProspectSchema', () => {
  it('passes with valid partial fields', () => {
    const result = updateProspectSchema.safeParse({
      name: 'Maria Silva',
      stage: 'qualificado',
    })
    expect(result.success).toBe(true)
  })

  it('passes with empty object (all fields optional)', () => {
    const result = updateProspectSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('passes with nullable assignedUserId set to null', () => {
    const result = updateProspectSchema.safeParse({
      assignedUserId: null,
    })
    expect(result.success).toBe(true)
  })

  it('passes with valid UUID for assignedUserId', () => {
    const result = updateProspectSchema.safeParse({
      assignedUserId: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(result.success).toBe(true)
  })

  it('fails with invalid UUID for assignedUserId', () => {
    const result = updateProspectSchema.safeParse({
      assignedUserId: 'not-a-uuid',
    })
    expect(result.success).toBe(false)
  })

  it('fails when notes exceed 2000 characters', () => {
    const result = updateProspectSchema.safeParse({
      notes: 'a'.repeat(2001),
    })
    expect(result.success).toBe(false)
  })

  it('passes when notes are exactly 2000 characters', () => {
    const result = updateProspectSchema.safeParse({
      notes: 'a'.repeat(2000),
    })
    expect(result.success).toBe(true)
  })

  it('fails with invalid stage value', () => {
    const result = updateProspectSchema.safeParse({
      stage: 'invalid_stage',
    })
    expect(result.success).toBe(false)
  })

  it('accepts all valid stage values', () => {
    for (const stage of PROSPECT_STAGES) {
      const result = updateProspectSchema.safeParse({ stage })
      expect(result.success).toBe(true)
    }
  })

  it('fails when lostReason exceeds 500 characters', () => {
    const result = updateProspectSchema.safeParse({
      lostReason: 'a'.repeat(501),
    })
    expect(result.success).toBe(false)
  })
})

describe('convertProspectSchema', () => {
  it('passes with patientId', () => {
    const result = convertProspectSchema.safeParse({
      patientId: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(result.success).toBe(true)
  })

  it('passes with createPatient', () => {
    const result = convertProspectSchema.safeParse({
      createPatient: {
        fullName: 'Maria Silva',
        phone: '11999998888',
      },
    })
    expect(result.success).toBe(true)
  })

  it('passes with both patientId and createPatient', () => {
    const result = convertProspectSchema.safeParse({
      patientId: '550e8400-e29b-41d4-a716-446655440000',
      createPatient: {
        fullName: 'Maria Silva',
        phone: '11999998888',
      },
    })
    expect(result.success).toBe(true)
  })

  it('fails when neither patientId nor createPatient is provided', () => {
    const result = convertProspectSchema.safeParse({})
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'Selecione um paciente ou crie um novo',
      )
    }
  })

  it('fails with invalid patientId (not a UUID)', () => {
    const result = convertProspectSchema.safeParse({
      patientId: 'bad-id',
    })
    expect(result.success).toBe(false)
  })

  it('fails when createPatient has empty fullName', () => {
    const result = convertProspectSchema.safeParse({
      createPatient: {
        fullName: '',
        phone: '11999998888',
      },
    })
    expect(result.success).toBe(false)
  })

  it('fails when createPatient has empty phone', () => {
    const result = convertProspectSchema.safeParse({
      createPatient: {
        fullName: 'Maria Silva',
        phone: '',
      },
    })
    expect(result.success).toBe(false)
  })
})

describe('prospectFilterSchema', () => {
  it('passes with valid stage filter', () => {
    const result = prospectFilterSchema.safeParse({ stage: 'novo' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.stage).toBe('novo')
    }
  })

  it('fails with invalid stage value', () => {
    const result = prospectFilterSchema.safeParse({ stage: 'unknown' })
    expect(result.success).toBe(false)
  })

  it('passes with empty object (all fields optional)', () => {
    const result = prospectFilterSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('passes with search string', () => {
    const result = prospectFilterSchema.safeParse({ search: 'Maria' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.search).toBe('Maria')
    }
  })

  it('passes with valid assignedUserId', () => {
    const result = prospectFilterSchema.safeParse({
      assignedUserId: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(result.success).toBe(true)
  })

  it('fails with invalid assignedUserId', () => {
    const result = prospectFilterSchema.safeParse({
      assignedUserId: 'not-a-uuid',
    })
    expect(result.success).toBe(false)
  })

  it('accepts all valid stage values', () => {
    for (const stage of PROSPECT_STAGES) {
      const result = prospectFilterSchema.safeParse({ stage })
      expect(result.success).toBe(true)
    }
  })
})
