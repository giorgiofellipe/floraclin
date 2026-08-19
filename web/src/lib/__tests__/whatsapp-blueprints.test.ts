import { describe, it, expect } from 'vitest'
import {
  TEMPLATE_BLUEPRINTS,
  PURPOSE_LABELS,
  generateTemplateName,
  resolveTemplatePrefix,
  belongsToTemplatePrefix,
  findBlueprintForTemplateName,
  getTemplateDisplayLabel,
  buildTemplatePreview,
} from '../whatsapp-blueprints'

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

describe('resolveTemplatePrefix', () => {
  it('returns the existing persisted prefix when present', () => {
    expect(resolveTemplatePrefix('Clínica Flora', 'dra_micaela_floriani'))
      .toBe('dra_micaela_floriani')
  })

  it('derives a deterministic fallback from the tenant name when missing', () => {
    expect(resolveTemplatePrefix('Clínica Flora', undefined))
      .toBe('clinica_flora')
    expect(resolveTemplatePrefix('Clínica Flora', null))
      .toBe('clinica_flora')
    expect(resolveTemplatePrefix('Clínica Flora', ''))
      .toBe('clinica_flora')
  })
})

describe('belongsToTemplatePrefix', () => {
  it('matches a template name that starts with prefix_', () => {
    expect(belongsToTemplatePrefix('dra_micaela_floriani_confirm_appointment', 'dra_micaela_floriani'))
      .toBe(true)
  })

  it('rejects a foreign template whose prefix does not match', () => {
    expect(belongsToTemplatePrefix('dra_nicole_biomedica_esteta_confirm_appointment', 'dra_micaela_floriani'))
      .toBe(false)
  })

  it('rejects a name that merely contains the prefix without the trailing underscore boundary', () => {
    expect(belongsToTemplatePrefix('dra_micaela_florianix_confirm_appointment', 'dra_micaela_floriani'))
      .toBe(false)
  })

  it('returns false for an empty prefix rather than matching everything', () => {
    expect(belongsToTemplatePrefix('anything_at_all', '')).toBe(false)
  })
})

describe('findBlueprintForTemplateName', () => {
  it('matches a template name to its blueprint by suffix', () => {
    const blueprint = findBlueprintForTemplateName('dra_micaela_floriani_confirm_appointment')
    expect(blueprint?.purposeKey).toBe('appointment_confirmation')
  })

  it('returns null when no blueprint suffix matches', () => {
    expect(findBlueprintForTemplateName('dra_micaela_floriani_something_unrelated')).toBeNull()
  })

  it('has no suffix overlaps in the real blueprint list today', () => {
    // Documents the current state: verified by exhaustive pairwise check that
    // no blueprint.name is a suffix of another blueprint.name. The
    // longest-match logic below is a guardrail for if/when that changes.
    for (const a of TEMPLATE_BLUEPRINTS) {
      for (const b of TEMPLATE_BLUEPRINTS) {
        if (a === b) continue
        expect(a.name.endsWith(`_${b.name}`) || a.name === b.name).toBe(false)
      }
    }
  })

  it('longest suffix match wins when a shorter blueprint name is itself a suffix of a longer one', () => {
    // Synthetic scenario: today's real blueprint list has no such overlap
    // (see test above), but a naive "first match in list order" would
    // mislabel a template if it ever did. Injecting a fixture list exercises
    // that tie-breaking logic directly against the real function.
    const base = TEMPLATE_BLUEPRINTS[0]
    const short = { ...base, slug: 'short', purposeKey: 'short_purpose', name: 'reminder' }
    const long = { ...base, slug: 'long', purposeKey: 'long_purpose', name: 'appointment_reminder' }

    // `short` listed first, so a naive first-match would pick it even though
    // the template name is really the `long` blueprint.
    const match = findBlueprintForTemplateName('dra_x_appointment_reminder', [short, long])
    expect(match?.slug).toBe('long')
    expect(match?.slug).not.toBe('short')
  })
})

describe('getTemplateDisplayLabel', () => {
  it('prefers the persisted purposeKey label when present', () => {
    const label = getTemplateDisplayLabel({
      purposeKey: 'appointment_confirmation',
      name: 'dra_micaela_floriani_confirm_appointment',
    })
    expect(label).toBe(PURPOSE_LABELS.appointment_confirmation)
  })

  it('derives the label from the name suffix when purposeKey is null', () => {
    const label = getTemplateDisplayLabel({
      purposeKey: null,
      name: 'dra_micaela_floriani_confirm_appointment',
    })
    expect(label).toBe(PURPOSE_LABELS.appointment_confirmation)
  })

  it('falls back to the raw name when nothing matches', () => {
    const label = getTemplateDisplayLabel({
      purposeKey: null,
      name: 'dra_micaela_floriani_totally_custom_template',
    })
    expect(label).toBe('dra_micaela_floriani_totally_custom_template')
  })

  it('does not throw when two different rows resolve to the same purpose label', () => {
    const a = getTemplateDisplayLabel({ purposeKey: null, name: 'tenant_a_confirm_appointment' })
    const b = getTemplateDisplayLabel({ purposeKey: null, name: 'tenant_a_confirm_appointment' })
    expect(a).toBe(b)
    expect(a).toBe(PURPOSE_LABELS.appointment_confirmation)
  })
})

describe('buildTemplatePreview', () => {
  const confirmation = TEMPLATE_BLUEPRINTS.find(
    (b) => b.purposeKey === 'appointment_confirmation',
  )!

  it('fills every variable with its example value', () => {
    const { body } = buildTemplatePreview(
      {
        name: 'clinica_flora_confirm_appointment',
        purposeKey: 'appointment_confirmation',
        components: confirmation.components,
        variableMapping: confirmation.variables,
      },
      'Clínica Flora',
    )

    expect(body).not.toMatch(/\{\{\d+\}\}/)
    expect(body).toContain('Maria Silva')
    expect(body).toContain('15/04/2026')
  })

  it('uses the real clinic name for the clinic_name variable', () => {
    const { body } = buildTemplatePreview(
      {
        name: 'clinica_flora_confirm_appointment',
        purposeKey: 'appointment_confirmation',
        components: confirmation.components,
        variableMapping: confirmation.variables,
      },
      'Dra. Micaela Floriani',
    )

    expect(body).toContain('Dra. Micaela Floriani')
    expect(body).not.toContain('Clínica Flora')
  })

  it('falls back to the blueprint variables when variableMapping is missing', () => {
    const { body } = buildTemplatePreview(
      {
        name: 'clinica_flora_confirm_appointment',
        purposeKey: null,
        components: confirmation.components,
        variableMapping: null,
      },
      'Clínica Flora',
    )

    expect(body).not.toMatch(/\{\{\d+\}\}/)
  })

  it('returns the quick-reply button labels', () => {
    const { buttons } = buildTemplatePreview(
      {
        name: 'clinica_flora_confirm_appointment',
        purposeKey: 'appointment_confirmation',
        components: confirmation.components,
        variableMapping: confirmation.variables,
      },
      'Clínica Flora',
    )

    expect(buttons).toEqual(['Confirmar', 'Reagendar'])
  })

  it('returns an empty preview when the template has no BODY component', () => {
    const preview = buildTemplatePreview(
      { name: 'x', purposeKey: null, components: null, variableMapping: null },
      'Clínica Flora',
    )

    expect(preview).toEqual({ body: '', buttons: [] })
  })
})
