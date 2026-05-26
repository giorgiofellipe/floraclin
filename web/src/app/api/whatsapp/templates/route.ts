import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { listTemplates, createLocalTemplate, upsertTemplate } from '@/db/queries/whatsapp'
import { createTemplate as createMetaTemplate, getTemplates as fetchMetaTemplates } from '@/lib/whatsapp'
import { createTemplateSchema } from '@/validations/whatsapp'

async function checkWhatsAppAccess(requireOwner: boolean) {
  const ctx = await getAuthContext()
  const tenant = await getTenant(ctx.tenantId)
  const settings = tenant?.settings as Record<string, unknown> | null
  if (!settings?.whatsapp_enabled) {
    throw new Error('WhatsApp not enabled')
  }
  if (requireOwner) {
    if (ctx.role !== 'owner') {
      throw new Error('Forbidden')
    }
  } else {
    const allowedRoles = (settings.whatsapp_allowed_roles as string[]) ?? ['owner']
    if (!allowedRoles.includes(ctx.role)) {
      throw new Error('Forbidden')
    }
  }
  return { ctx, tenant: tenant!, settings }
}

export async function GET() {
  try {
    const { ctx } = await checkWhatsAppAccess(false)
    const templates = await listTemplates(ctx.tenantId)

    if (templates.length > 0) {
      const mostRecent = templates.reduce((a, b) =>
        new Date(a.syncedAt) > new Date(b.syncedAt) ? a : b
      )
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
      if (new Date(mostRecent.syncedAt) < fiveMinAgo) {
        try {
          const metaTemplates = await fetchMetaTemplates(ctx.tenantId)
          for (const tpl of metaTemplates) {
            await upsertTemplate(ctx.tenantId, {
              metaTemplateId: tpl.id,
              name: tpl.name,
              language: tpl.language,
              category: tpl.category,
              status: tpl.status,
              components: tpl.components,
              rejectedReason: tpl.rejected_reason ?? null,
            })
          }
          const refreshed = await listTemplates(ctx.tenantId)
          return NextResponse.json({ data: refreshed })
        } catch (syncErr) {
          console.error('Background template sync failed:', syncErr)
        }
      }
    }

    return NextResponse.json({ data: templates })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg === 'WhatsApp not enabled') return NextResponse.json({ error: msg }, { status: 400 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error listing WhatsApp templates:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { ctx } = await checkWhatsAppAccess(true)
    const body = await request.json()
    const parsed = createTemplateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { name, category, language, components, purposeKey, variableMapping } = parsed.data

    const metaResult = await createMetaTemplate(ctx.tenantId, {
      name,
      category,
      language,
      components,
    })

    const template = await createLocalTemplate(ctx.tenantId, {
      metaTemplateId: metaResult.id,
      name,
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
    if (msg === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg === 'WhatsApp not enabled') return NextResponse.json({ error: msg }, { status: 400 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (msg.includes('Meta API error')) {
      return NextResponse.json({ error: msg }, { status: 422 })
    }
    console.error('Error creating WhatsApp template:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
