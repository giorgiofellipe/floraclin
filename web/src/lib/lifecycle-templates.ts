import { OPT_OUT_FOOTER, type LifecycleMessage } from '@/lib/lifecycle-messages'

// Meta only allows a URL button variable at the end of the URL; its example is the variable value alone.
const EXAMPLE_SEND_ID = '00000000-0000-0000-0000-000000000000'

export function buildLifecycleTemplateDefinition(message: LifecycleMessage, appUrl: string) {
  return {
    name: message.templateName,
    category: message.category,
    language: 'pt_BR',
    components: [
      { type: 'BODY', text: message.body, example: { body_text: [['Ana']] } },
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
