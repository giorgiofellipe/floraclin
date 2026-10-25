import { OPT_OUT_FOOTER, type LifecycleMessage } from '@/lib/lifecycle-messages'

// Meta only allows a URL button variable at the end of the URL; its example is the variable value alone.
const EXAMPLE_SEND_ID = '00000000-0000-0000-0000-000000000000'
const EXAMPLE_NAME = 'Ana'
const EXAMPLE_OFFER = ['30% de desconto nos 3 primeiros meses', '06/11']

/** The Meta definitions of a message: its template, plus the offer variant when it has one. */
export function buildLifecycleTemplateDefinitions(message: LifecycleMessage, appUrl: string) {
  return [
    templateDefinition(message, message.templateName, message.body, [EXAMPLE_NAME], appUrl),
    ...(message.offerTemplate
      ? [templateDefinition(message, message.offerTemplate.name, message.offerTemplate.body, [EXAMPLE_NAME, ...EXAMPLE_OFFER], appUrl)]
      : []),
  ]
}

function templateDefinition(message: LifecycleMessage, name: string, body: string, bodyExample: string[], appUrl: string) {
  return {
    name,
    category: message.category,
    language: 'pt_BR',
    components: [
      { type: 'BODY', text: body, example: { body_text: [bodyExample] } },
      ...(message.category === 'MARKETING' ? [{ type: 'FOOTER', text: OPT_OUT_FOOTER }] : []),
      ...(message.button
        ? [{
            type: 'BUTTONS',
            buttons: [{
              type: 'URL',
              text: message.button.label,
              url: `${appUrl}/api/lifecycle/click?lc={{1}}`,
              example: [EXAMPLE_SEND_ID],
            }],
          }]
        : []),
    ],
  }
}
