/**
 * Deletes leftover WhatsApp template rows that were imported into the wrong
 * tenant by the pre-fix sync bug (web/src/app/api/whatsapp/templates/sync/route.ts
 * used to call getTemplates(tenantId), which actually returns every template
 * on the shared FloraClin WABA, not just this tenant's own, and upserted all
 * of them under the syncing tenant).
 *
 * A row is "foreign pollution" -- safe to delete -- only when ALL of:
 *   - its `name` does NOT start with the owning tenant's
 *     `${whatsapp_template_prefix}_` (see resolveTemplatePrefix /
 *     belongsToTemplatePrefix in web/src/lib/whatsapp-blueprints.ts)
 *   - its `purpose_key` is NULL (a matched purpose means provisioning
 *     explicitly claimed this row for this tenant -- never touch it)
 *   - `system_template` is false (system rows are intentionally shared
 *     across tenants and are not scoped by prefix at all)
 *
 * ─── Safety, all enforced before any write ──────────────────────────────
 *
 * - `--dry-run` (the default) prints the per-tenant plan and writes nothing.
 * - `--yes` is required to actually delete rows.
 * - Never deletes a row with a non-null purpose_key.
 * - Never deletes a row where system_template is true.
 * - Only ever deletes rows matched by the foreign-pollution rule above --
 *   everything else is reported as "kept".
 */

import { pathToFileURL } from 'node:url'
import { inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenants, whatsappTemplates } from '@/db/schema'
import { resolveTemplatePrefix, belongsToTemplatePrefix } from '@/lib/whatsapp-blueprints'

interface TenantPlan {
  tenantId: string
  tenantName: string
  prefix: string
  toRemove: Array<{ id: string; name: string; purposeKey: string | null }>
  keptCount: number
}

async function buildPlan(): Promise<TenantPlan[]> {
  const allTenants = await db
    .select({ id: tenants.id, name: tenants.name, settings: tenants.settings })
    .from(tenants)

  const allTemplates = await db
    .select({
      id: whatsappTemplates.id,
      tenantId: whatsappTemplates.tenantId,
      name: whatsappTemplates.name,
      purposeKey: whatsappTemplates.purposeKey,
      systemTemplate: whatsappTemplates.systemTemplate,
    })
    .from(whatsappTemplates)

  const templatesByTenant = new Map<string, typeof allTemplates>()
  for (const tpl of allTemplates) {
    const list = templatesByTenant.get(tpl.tenantId) ?? []
    list.push(tpl)
    templatesByTenant.set(tpl.tenantId, list)
  }

  const plans: TenantPlan[] = []

  for (const tenant of allTenants) {
    const rows = templatesByTenant.get(tenant.id)
    if (!rows || rows.length === 0) continue

    const settings = (tenant.settings ?? {}) as Record<string, unknown>
    const prefix = resolveTemplatePrefix(
      tenant.name,
      settings.whatsapp_template_prefix as string | undefined,
    )

    const toRemove: TenantPlan['toRemove'] = []
    let keptCount = 0

    for (const row of rows) {
      const isForeignPollution =
        !row.systemTemplate &&
        row.purposeKey === null &&
        !belongsToTemplatePrefix(row.name, prefix)

      if (isForeignPollution) {
        toRemove.push({ id: row.id, name: row.name, purposeKey: row.purposeKey })
      } else {
        keptCount++
      }
    }

    plans.push({
      tenantId: tenant.id,
      tenantName: tenant.name,
      prefix,
      toRemove,
      keptCount,
    })
  }

  return plans
}

function printUsage(): void {
  console.log('Usage: tsx scripts/cleanup-foreign-templates.ts [--dry-run | --yes]')
  console.log('')
  console.log('  --dry-run   Print the per-tenant plan. Writes nothing. This is the default.')
  console.log('  --yes       Actually delete the foreign-pollution rows.')
  console.log('')
  console.log('Never run this against production. Dry run only if you run it at all.')
}

async function main(): Promise<number> {
  const yes = process.argv.includes('--yes')
  const dryRun = !yes

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Refusing to run.')
    return 1
  }

  console.log(`Foreign WhatsApp template cleanup${dryRun ? ' (DRY RUN, nothing will be written)' : ''}`)
  console.log('')

  const plans = await buildPlan()
  const tenantsWithRemovals = plans.filter((p) => p.toRemove.length > 0)

  let totalRemove = 0
  let totalKeep = 0

  for (const plan of plans) {
    totalRemove += plan.toRemove.length
    totalKeep += plan.keptCount
    if (plan.toRemove.length === 0) continue

    console.log(`Tenant ${plan.tenantName} (${plan.tenantId})`)
    console.log(`  prefix: ${plan.prefix}`)
    console.log(`  would remove: ${plan.toRemove.length}  kept: ${plan.keptCount}`)
    for (const row of plan.toRemove.slice(0, 10)) {
      console.log(`    - ${row.name}`)
    }
    if (plan.toRemove.length > 10) {
      console.log(`    ... and ${plan.toRemove.length - 10} more`)
    }
    console.log('')
  }

  console.log(`Tenants affected: ${tenantsWithRemovals.length}`)
  console.log(`Total rows to remove: ${totalRemove}`)
  console.log(`Total rows kept: ${totalKeep}`)
  console.log('')

  if (dryRun) {
    console.log('Dry run complete. Nothing was written. Pass --yes to delete.')
    return 0
  }

  if (totalRemove === 0) {
    console.log('Nothing to delete.')
    return 0
  }

  for (const plan of tenantsWithRemovals) {
    const ids = plan.toRemove.map((row) => row.id)
    await db.delete(whatsappTemplates).where(inArray(whatsappTemplates.id, ids))
  }

  console.log(`Deleted ${totalRemove} foreign template row(s) across ${tenantsWithRemovals.length} tenant(s).`)
  return 0
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}

export { buildPlan }
