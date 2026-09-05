import { NextResponse, after } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { getTenant } from '@/db/queries/tenants'
import { listTemplates, createLocalTemplate, updateLocalTemplate } from '@/db/queries/whatsapp'
import { updateTenantSettings } from '@/db/queries/tenants'
import {
  canManageTemplates,
  createTemplate as createMetaTemplate,
  getTemplate as getMetaTemplate,
  isWhatsAppEnabled,
  syncTemplatesForTenant,
} from '@/lib/whatsapp'
import { resolveTemplatePrefix } from '@/lib/whatsapp-blueprints'
import { createTemplateSchema } from '@/validations/whatsapp'
import { ForbiddenError } from '@/lib/errors'
import { handleApiError } from '@/lib/api-error'
import { reportSideEffectFailure } from '@/lib/observability'

async function checkWhatsAppAccess(requireOwner: boolean) {
  const ctx = await getAuthContext()
  const tenant = await getTenant(ctx.tenantId)
  const settings = tenant?.settings as Record<string, unknown> | null
  if (!isWhatsAppEnabled(settings)) {
    throw new Error('WhatsApp not enabled')
  }
  if (requireOwner) {
    if (ctx.role !== 'owner') {
      throw new ForbiddenError()
    }
  } else {
    const allowedRoles = (settings?.whatsapp_allowed_roles as string[]) ?? ['owner']
    if (!allowedRoles.includes(ctx.role)) {
      throw new ForbiddenError()
    }
  }
  return { ctx, tenant: tenant!, settings }
}

// A template is written locally as PENDING the moment it's created, and Meta
// usually approves it seconds later. The background sync below can't repair
// that: it only runs when the newest row is over 5 minutes old, and it lands
// after the response. So a just-approved template kept rendering "em revisão"
// until the clinic reloaded the page twice. PENDING rows are few and the state
// is short-lived, so refresh them inline and answer with the real status.
const MAX_INLINE_REFRESH = 10

async function refreshPendingTemplates(
  tenantId: string,
  templates: Awaited<ReturnType<typeof listTemplates>>,
): Promise<boolean> {
  const pending = templates
    .filter((t) => t.status === 'PENDING' && t.metaTemplateId)
    .slice(0, MAX_INLINE_REFRESH)
  if (pending.length === 0) return false

  const results = await Promise.all(
    pending.map(async (template) => {
      try {
        const metaData = await getMetaTemplate(tenantId, template.metaTemplateId!)
        if (metaData.status === template.status) return false
        await updateLocalTemplate(tenantId, template.id, {
          status: metaData.status,
          rejectedReason: metaData.rejected_reason ?? null,
          syncedAt: new Date(),
        })
        return true
      } catch {
        // Meta unreachable — keep the local status rather than failing the list
        return false
      }
    }),
  )

  return results.some(Boolean)
}

export async function GET(request: Request) {
  try {
    const { ctx, tenant, settings } = await checkWhatsAppAccess(false)
    let templates = await listTemplates(ctx.tenantId)

    if (await refreshPendingTemplates(ctx.tenantId, templates)) {
      templates = await listTemplates(ctx.tenantId)
    }

    // The full Meta sync can take 10s+ — never block the response on it.
    // Serve local data immediately and refresh in the background via after();
    // the client picks up the fresh rows on its next fetch or manual sync.
    // (The targeted PENDING refresh above is a different thing: a handful of
    // single-template reads, and every reader of this route — settings, the
    // chat template picker, birthdays — wants a PENDING row's real status.)
    if (templates.length > 0) {
      const mostRecent = templates.reduce((a, b) =>
        new Date(a.syncedAt) > new Date(b.syncedAt) ? a : b
      )
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
      if (new Date(mostRecent.syncedAt) < fiveMinAgo) {
        const tenantId = ctx.tenantId
        // Own-prefix filtering happens inside syncTemplatesForTenant: the
        // shared WABA returns every clinic's templates here too.
        const prefix = resolveTemplatePrefix(
          tenant.name,
          settings?.whatsapp_template_prefix as string | undefined,
        )
        after(async () => {
          try {
            await syncTemplatesForTenant(tenantId, prefix)
          } catch (syncErr) {
            reportSideEffectFailure(syncErr, { area: 'whatsapp', step: 'template_sync' })
          }
        })
      }
    }

    return NextResponse.json({ data: templates })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg === 'WhatsApp not enabled') return NextResponse.json({ error: msg }, { status: 400 })
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    const { ctx, tenant, settings } = await checkWhatsAppAccess(true)
    const { blocked } = await requireWrite('owner')
    if (blocked) return blocked
    if (!canManageTemplates(settings)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = await request.json()
    const parsed = createTemplateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { name, category, language, components, purposeKey, variableMapping } = parsed.data

    // Named with the tenant prefix like provisioned templates are, otherwise
    // the clinic's own template is invisible to listTemplates and reads as
    // another clinic's row to every prefix-based check.
    let prefix = settings?.whatsapp_template_prefix as string | undefined
    if (!prefix) {
      prefix = resolveTemplatePrefix(tenant.name)
      await updateTenantSettings(ctx.tenantId, { whatsapp_template_prefix: prefix })
    }
    const prefixedName = name.startsWith(`${prefix}_`) ? name : `${prefix}_${name}`

    const metaResult = await createMetaTemplate(ctx.tenantId, {
      name: prefixedName,
      category,
      language,
      components,
    })

    const template = await createLocalTemplate(ctx.tenantId, {
      metaTemplateId: metaResult.id,
      name: prefixedName,
      language,
      category,
      status: metaResult.status || 'PENDING',
      components,
      purposeKey,
      submittedAt: new Date(),
      variableMapping,
    })

    return NextResponse.json({ data: template }, { status: 201 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg === 'WhatsApp not enabled') return NextResponse.json({ error: msg }, { status: 400 })
    if (msg.includes('Meta API error')) {
      return NextResponse.json({ error: msg }, { status: 422 })
    }
    return handleApiError(error, request)
  }
}
