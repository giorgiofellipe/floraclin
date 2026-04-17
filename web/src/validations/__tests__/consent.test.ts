import { describe, it, expect } from 'vitest'
import { consentTemplateSchema, consentAcceptanceSchema } from '../consent'

describe('consentTemplateSchema', () => {
  const validTemplate = {
    type: 'botox' as const,
    title: 'Termo de Consentimento',
    content: 'Este termo descreve os riscos do procedimento...',
  }

  it('passes with valid template', () => {
    const result = consentTemplateSchema.safeParse(validTemplate)
    expect(result.success).toBe(true)
  })

  it('accepts all valid types', () => {
    const types = ['general', 'botox', 'filler', 'biostimulator', 'limpeza_pele', 'enzima', 'skinbooster', 'microagulhamento', 'custom', 'service_contract']
    for (const type of types) {
      const result = consentTemplateSchema.safeParse({ ...validTemplate, type })
      expect(result.success).toBe(true)
    }
  })

  it('fails with invalid type', () => {
    const result = consentTemplateSchema.safeParse({ ...validTemplate, type: 'laser' })
    expect(result.success).toBe(false)
  })

  it('fails when title is too short', () => {
    const result = consentTemplateSchema.safeParse({ ...validTemplate, title: 'ab' })
    expect(result.success).toBe(false)
  })

  it('fails when title exceeds 255 characters', () => {
    const result = consentTemplateSchema.safeParse({ ...validTemplate, title: 'a'.repeat(256) })
    expect(result.success).toBe(false)
  })

  it('fails when content is too short', () => {
    const result = consentTemplateSchema.safeParse({ ...validTemplate, content: 'short' })
    expect(result.success).toBe(false)
  })

  it('fails when type is missing', () => {
    const { type, ...rest } = validTemplate
    const result = consentTemplateSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })
})

describe('consentAcceptanceSchema', () => {
  const validAcceptance = {
    patientId: '550e8400-e29b-41d4-a716-446655440000',
    consentTemplateId: '550e8400-e29b-41d4-a716-446655440001',
    acceptanceMethod: 'checkbox' as const,
  }

  it('passes with checkbox method (no signature needed)', () => {
    const result = consentAcceptanceSchema.safeParse(validAcceptance)
    expect(result.success).toBe(true)
  })

  it('passes with signature method and valid signature data', () => {
    const result = consentAcceptanceSchema.safeParse({
      ...validAcceptance,
      acceptanceMethod: 'signature',
      signatureData: 'data:image/png;base64,abc123',
    })
    expect(result.success).toBe(true)
  })

  it('fails with signature method but missing signature data', () => {
    const result = consentAcceptanceSchema.safeParse({
      ...validAcceptance,
      acceptanceMethod: 'signature',
    })
    expect(result.success).toBe(false)
  })

  it('fails with signature method and invalid signature data format', () => {
    const result = consentAcceptanceSchema.safeParse({
      ...validAcceptance,
      acceptanceMethod: 'signature',
      signatureData: 'not-a-data-uri',
    })
    expect(result.success).toBe(false)
  })

  it('fails with "both" method but missing signature data', () => {
    const result = consentAcceptanceSchema.safeParse({
      ...validAcceptance,
      acceptanceMethod: 'both',
    })
    expect(result.success).toBe(false)
  })

  it('passes with "both" method and valid signature data', () => {
    const result = consentAcceptanceSchema.safeParse({
      ...validAcceptance,
      acceptanceMethod: 'both',
      signatureData: 'data:image/svg+xml;base64,abc',
    })
    expect(result.success).toBe(true)
  })

  it('fails with invalid patientId', () => {
    const result = consentAcceptanceSchema.safeParse({
      ...validAcceptance,
      patientId: 'bad-uuid',
    })
    expect(result.success).toBe(false)
  })

  it('fails with invalid acceptanceMethod', () => {
    const result = consentAcceptanceSchema.safeParse({
      ...validAcceptance,
      acceptanceMethod: 'verbal',
    })
    expect(result.success).toBe(false)
  })

  it('allows optional procedureRecordId', () => {
    const result = consentAcceptanceSchema.safeParse({
      ...validAcceptance,
      procedureRecordId: '550e8400-e29b-41d4-a716-446655440002',
    })
    expect(result.success).toBe(true)
  })
})
