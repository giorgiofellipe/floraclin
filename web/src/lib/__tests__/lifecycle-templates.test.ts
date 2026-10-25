import { describe, expect, it } from 'vitest'
import { LIFECYCLE_MESSAGES } from '@/lib/lifecycle-messages'
import { buildLifecycleTemplateDefinitions } from '@/lib/lifecycle-templates'

const definitions = LIFECYCLE_MESSAGES.flatMap((message) =>
  buildLifecycleTemplateDefinitions(message, 'https://staging.example').map((definition) => ({ message, definition })),
)

describe('buildLifecycleTemplateDefinitions', () => {
  it.each(definitions.filter(({ message }) => message.button).map(({ message, definition }) => [definition.name, message, definition] as const))(
    '%s points its button at the click route on the given app URL, with the send id last',
    (_name, message, definition) => {
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

  it.each(definitions.map(({ definition }) => [definition.name, definition] as const))(
    '%s gives one body example per variable. Regression: Meta rejects the template at creation',
    (_name, definition) => {
      const body = definition.components.find((c) => c.type === 'BODY') as { text: string; example: { body_text: string[][] } }
      expect(body.example.body_text[0]).toHaveLength(body.text.match(/\{\{\d\}\}/g)!.length)
    },
  )

  it('builds the offer variants with the plain win-back and final templates. Regression: the offer templates never get provisioned', () => {
    expect(definitions.map(({ definition }) => definition.name)).toEqual(
      expect.arrayContaining(['trial_winback_click', 'trial_winback_offer_click', 'trial_final_click', 'trial_final_offer_click']),
    )
  })
})
