import { describe, it, expect } from 'vitest'
import { consentTemplateSchema, consentAcceptanceSchema, deviceFingerprintSchema, remoteConsentSignatureSchema, CONSENT_SIGNING_TEMPLATE_PURPOSE, sendSigningLinkSchema } from '../consent'

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

describe('deviceFingerprintSchema', () => {
  it('passes with valid fingerprint', () => {
    const result = deviceFingerprintSchema.safeParse({
      screen: '1920x1080',
      timezone: 'America/Sao_Paulo',
      language: 'pt-BR',
    })
    expect(result.success).toBe(true)
  })

  it('fails when screen is missing', () => {
    const result = deviceFingerprintSchema.safeParse({
      timezone: 'America/Sao_Paulo',
      language: 'pt-BR',
    })
    expect(result.success).toBe(false)
  })
})

describe('remoteConsentSignatureSchema', () => {
  const valid = {
    token: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    signatures: [
      {
        consentTemplateId: '550e8400-e29b-41d4-a716-446655440001',
        signatureData: 'data:image/png;base64,abc',
        deviceFingerprint: { screen: '1920x1080', timezone: 'America/Sao_Paulo', language: 'pt-BR' },
      },
    ],
  }

  it('passes with valid data', () => {
    const result = remoteConsentSignatureSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('passes with optional geolocation', () => {
    const result = remoteConsentSignatureSchema.safeParse({
      ...valid,
      signatures: [{ ...valid.signatures[0], geolocation: { lat: -23.55, lng: -46.63 } }],
    })
    expect(result.success).toBe(true)
  })

  it('fails with empty signatures array', () => {
    const result = remoteConsentSignatureSchema.safeParse({ ...valid, signatures: [] })
    expect(result.success).toBe(false)
  })

  it('fails with invalid signature data', () => {
    const result = remoteConsentSignatureSchema.safeParse({
      ...valid,
      signatures: [{ ...valid.signatures[0], signatureData: 'not-a-data-uri' }],
    })
    expect(result.success).toBe(false)
  })
})

describe('CONSENT_SIGNING_TEMPLATE_PURPOSE', () => {
  it('is defined as consent_signing_link', () => {
    expect(CONSENT_SIGNING_TEMPLATE_PURPOSE).toBe('consent_signing_link')
  })
})

describe('sendSigningLinkSchema', () => {
  const patientId = '11111111-1111-4111-8111-111111111111'
  const procedureRecordId = '22222222-2222-4222-8222-222222222222'
  const templateId = '33333333-3333-4333-8333-333333333333'

  it('accepts consent types with a procedure', () => {
    expect(sendSigningLinkSchema.safeParse({ patientId, procedureRecordId, consentTypes: ['botox'] }).success).toBe(true)
  })

  it('accepts explicit template ids without a procedure', () => {
    expect(sendSigningLinkSchema.safeParse({ patientId, consentTemplateIds: [templateId] }).success).toBe(true)
  })

  it('rejects consent types without a procedure', () => {
    expect(sendSigningLinkSchema.safeParse({ patientId, consentTypes: ['botox'] }).success).toBe(false)
  })

  it('rejects both selectors together and neither selector', () => {
    expect(
      sendSigningLinkSchema.safeParse({ patientId, procedureRecordId, consentTypes: ['botox'], consentTemplateIds: [templateId] }).success,
    ).toBe(false)
    expect(sendSigningLinkSchema.safeParse({ patientId }).success).toBe(false)
  })

  it('rejects an empty template id list', () => {
    expect(sendSigningLinkSchema.safeParse({ patientId, consentTemplateIds: [] }).success).toBe(false)
  })
})
