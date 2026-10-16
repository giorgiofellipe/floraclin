import { describe, expect, it } from 'vitest'
import { LIFECYCLE_MESSAGES } from '@/lib/lifecycle-messages'
import { buildLifecycleTemplateDefinition } from '@/lib/lifecycle-templates'

describe('buildLifecycleTemplateDefinition', () => {
  it.each(LIFECYCLE_MESSAGES.filter((m) => m.button).map((m) => [m.key, m] as const))(
    '%s points its button at the click route on the given app URL, with the send id last',
    (_key, message) => {
      const definition = buildLifecycleTemplateDefinition(message, 'https://staging.example')

      expect(definition.components).toContainEqual({
        type: 'BUTTONS',
        buttons: [{
          type: 'URL',
          text: message.button!.label,
          url: 'https://staging.example/api/lifecycle/click?lc={{1}}',
          example: ['00000000-0000-0000-0000-000000000000'],
        }],
      })
    },
  )
})
