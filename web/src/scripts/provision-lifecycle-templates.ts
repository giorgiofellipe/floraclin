/**
 * Creates the trial lifecycle WhatsApp templates on the FloraClin platform WABA (FLORACLIN_WA_*).
 * Meta does not allow content edits on approved templates. Messages with URL buttons
 * are provisioned under `trackedTemplateName` so the existing static-button template
 * can remain as the runtime fallback until the tracked template is APPROVED.
 *
 * Run (env from web/.env.local is loaded automatically):
 *   cd web && npx tsx --tsconfig tsconfig.json src/scripts/provision-lifecycle-templates.ts [--only=<key>] [--dry-run]
 */
import { config as loadEnv } from 'dotenv'
import type { LifecycleMessage } from '@/lib/lifecycle-messages'

loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

export function buildLifecycleTemplateDefinition(
  message: LifecycleMessage,
  appUrl: string,
  optOutFooter: string,
) {
  const templateName = message.trackedTemplateName ?? message.templateName
  const trackedClickUrl =
    message.button && message.trackedTemplateName
      ? `https://app.floraclin.com.br/api/lifecycle/click?d=${message.key}&lc={{1}}`
      : null
  return {
    name: templateName,
    category: message.category,
    language: 'pt_BR',
    components: [
      { type: 'BODY', text: message.body, example: { body_text: [['Ana']] } },
      ...(message.category === 'MARKETING' ? [{ type: 'FOOTER', text: optOutFooter }] : []),
      ...(message.button
        ? [
            {
              type: 'BUTTONS',
              buttons: [
                trackedClickUrl
                  ? {
                      type: 'URL',
                      text: message.button.label,
                      url: trackedClickUrl,
                      example: ['00000000-0000-0000-0000-000000000000'],
                    }
                  : { type: 'URL', text: message.button.label, url: `${appUrl}${message.button.path}` },
              ],
            },
          ]
        : []),
    ],
  }
}

async function main() {
  const { LIFECYCLE_MESSAGES, OPT_OUT_FOOTER } = await import('@/lib/lifecycle-messages')
  const { createPlatformTemplate } = await import('@/lib/platform-whatsapp')

  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const only = args.find((arg) => arg.startsWith('--only='))?.slice('--only='.length)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL is required')

  const messages = LIFECYCLE_MESSAGES.filter((message) => !only || message.key === only)
  if (messages.length === 0) throw new Error(`No lifecycle message matches --only=${only}`)

  for (const message of messages) {
    const definition = buildLifecycleTemplateDefinition(message, appUrl, OPT_OUT_FOOTER)

    if (dryRun) {
      console.log(JSON.stringify(definition, null, 2))
      continue
    }

    try {
      const { status } = await createPlatformTemplate(definition)
      console.log(`${definition.name}: ${status}`)
    } catch (error) {
      console.error(`${definition.name}: ${error instanceof Error ? error.message : error}`)
    }
  }
}

if (process.argv[1]?.includes('provision-lifecycle-templates')) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
