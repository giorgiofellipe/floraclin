import { describe, it, expect } from 'vitest'
import { TEMPLATE_BLUEPRINTS, generateTemplateName } from '../whatsapp-blueprints'

describe('whatsapp-blueprints', () => {
  it('exports a non-empty array of blueprints', () => {
    expect(TEMPLATE_BLUEPRINTS.length).toBeGreaterThan(0)
  })

  it('each blueprint has unique slug', () => {
    const slugs = TEMPLATE_BLUEPRINTS.map((b) => b.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('each blueprint has unique purposeKey', () => {
    const keys = TEMPLATE_BLUEPRINTS.map((b) => b.purposeKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('template names are snake_case and lowercase', () => {
    for (const bp of TEMPLATE_BLUEPRINTS) {
      expect(bp.name).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })

  it('variable indices are sequential starting from 1', () => {
    for (const bp of TEMPLATE_BLUEPRINTS) {
      const indices = bp.variables.map((v) => v.index)
      for (let i = 0; i < indices.length; i++) {
        expect(indices[i]).toBe(i + 1)
      }
    }
  })

  it('body references match variable count', () => {
    for (const bp of TEMPLATE_BLUEPRINTS) {
      const bodyComponent = bp.components.find((c) => c.type === 'BODY')
      if (!bodyComponent) continue
      const matches = (bodyComponent.text as string).match(/\{\{\d+\}\}/g) ?? []
      const uniqueRefs = new Set(matches)
      expect(uniqueRefs.size).toBe(bp.variables.length)
    }
  })

  it('every blueprint has a valid category', () => {
    for (const bp of TEMPLATE_BLUEPRINTS) {
      expect(['UTILITY', 'MARKETING']).toContain(bp.category)
    }
  })
})

describe('generateTemplateName', () => {
  it('converts clinic name to snake_case prefix', () => {
    expect(generateTemplateName('Clínica Flora', 'appointment_reminder'))
      .toBe('clinica_flora_appointment_reminder')
  })

  it('handles names with dots and special chars', () => {
    expect(generateTemplateName('Dr. João', 'follow_up'))
      .toBe('dr_joao_follow_up')
  })

  it('handles simple names', () => {
    expect(generateTemplateName('Beleza', 'birthday_greeting'))
      .toBe('beleza_birthday_greeting')
  })

  it('handles names with multiple spaces', () => {
    expect(generateTemplateName('  Espaço  Saúde  ', 'payment_reminder'))
      .toBe('espaco_saude_payment_reminder')
  })

  it('prefixes with fc_ when name is purely numeric', () => {
    expect(generateTemplateName('123', 'follow_up'))
      .toBe('fc_123_follow_up')
  })

  it('prefixes with fc_ when name produces empty slug', () => {
    expect(generateTemplateName('!!!', 'birthday_greeting'))
      .toBe('fc__birthday_greeting')
  })
})
