/**
 * Creates the trial lifecycle WhatsApp templates on the FloraClin platform WABA (FLORACLIN_WA_*).
 * Meta does not allow content edits on approved templates: to change a body, rename
 * `templateName` in lifecycle-messages.ts and delete the old template on Meta (see AGENTS.md).
 * No code change is needed after approval: the sender checks the status on Meta before
 * each send and starts using a template as soon as Meta reports it APPROVED.
 *
 * Run (env from web/.env.local is loaded automatically):
 *   cd web && npx tsx --tsconfig tsconfig.json src/scripts/provision-lifecycle-templates.ts [--only=<key>] [--dry-run]
 */
import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

async function main() {
  const { LIFECYCLE_MESSAGES } = await import('@/lib/lifecycle-messages')
  const { buildLifecycleTemplateDefinition } = await import('@/lib/lifecycle-templates')
  const { createPlatformTemplate } = await import('@/lib/platform-whatsapp')

  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const only = args.find((arg) => arg.startsWith('--only='))?.slice('--only='.length)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL is required')

  const messages = LIFECYCLE_MESSAGES.filter((message) => !only || message.key === only)
  if (messages.length === 0) throw new Error(`No lifecycle message matches --only=${only}`)

  for (const message of messages) {
    const definition = buildLifecycleTemplateDefinition(message, appUrl)

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

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
