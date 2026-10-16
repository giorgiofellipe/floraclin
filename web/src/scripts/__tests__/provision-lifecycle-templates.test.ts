import { describe, expect, it } from 'vitest'
import { LIFECYCLE_MESSAGES, OPT_OUT_FOOTER } from '@/lib/lifecycle-messages'
import { buildLifecycleTemplateDefinition } from '../provision-lifecycle-templates'

describe('buildLifecycleTemplateDefinition', () => {
  it('uses tracked template names and dynamic lifecycle click URLs for button messages', () => {
    const message = LIFECYCLE_MESSAGES.find((item) => item.key === 'trial_welcome')!

    const definition = buildLifecycleTemplateDefinition(
      message,
      'https://app.floraclin.com.br',
      OPT_OUT_FOOTER,
    )

    expect(definition.name).toBe('trial_welcome_click')
    expect(definition.components).toContainEqual(
      expect.objectContaining({
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Abrir FloraClin',
            url: 'https://app.floraclin.com.br/api/lifecycle/click?d=trial_welcome&lc={{1}}',
            example: ['00000000-0000-0000-0000-000000000000'],
          },
        ],
      }),
    )
  })

  it('keeps no-button templates on the original template name', () => {
    const message = LIFECYCLE_MESSAGES.find((item) => item.key === 'trial_feedback')!

    const definition = buildLifecycleTemplateDefinition(
      message,
      'https://app.floraclin.com.br',
      OPT_OUT_FOOTER,
    )

    expect(definition.name).toBe('trial_feedback')
    expect(definition.components.some((component) => component.type === 'BUTTONS')).toBe(false)
  })
})
