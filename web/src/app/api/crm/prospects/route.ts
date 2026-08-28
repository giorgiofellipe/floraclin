import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { subscriptionGate } from '@/lib/plans'
import { getTenant } from '@/db/queries/tenants'
import { listProspects, getProspectStats, createProspect, logProspectActivity, getProspectProceduresBatch } from '@/db/queries/prospects'
import { prospectFilterSchema, createProspectSchema } from '@/validations/prospect'
import { db } from '@/db/client'
import { tenantUsers, users, procedureTypes } from '@/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import type { Role } from '@/types'
import { handleApiError } from '@/lib/api-error'
import { enqueueMetaEvent } from '@/lib/meta/events'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()

    // Check WhatsApp is enabled and user's role is allowed
    const tenant = await getTenant(ctx.tenantId)
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>
    if (!settings.whatsapp_enabled) {
      return NextResponse.json({ error: 'WhatsApp não está habilitado' }, { status: 403 })
    }
    const allowedRoles = (settings.whatsapp_allowed_roles as string[] | undefined) ?? ['owner']
    if (!allowedRoles.includes(ctx.role as Role) && ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Sem permissão para acessar o CRM' }, { status: 403 })
    }

    // Parse query filters
    const { searchParams } = new URL(request.url)
    const parsed = prospectFilterSchema.safeParse({
      stage: searchParams.get('stage') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      assignedUserId: searchParams.get('assignedUserId') ?? undefined,
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Filtros inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const [prospects, stats, members, procedures] = await Promise.all([
      listProspects(ctx.tenantId, parsed.data),
      getProspectStats(ctx.tenantId),
      db
        .select({ id: users.id, fullName: users.fullName })
        .from(tenantUsers)
        .innerJoin(users, eq(tenantUsers.userId, users.id))
        .where(
          and(
            eq(tenantUsers.tenantId, ctx.tenantId),
            eq(tenantUsers.isActive, true),
          ),
        ),
      db
        .select({
          id: procedureTypes.id,
          name: procedureTypes.name,
          defaultPrice: procedureTypes.defaultPrice,
        })
        .from(procedureTypes)
        .where(
          and(
            eq(procedureTypes.tenantId, ctx.tenantId),
            eq(procedureTypes.isActive, true),
            isNull(procedureTypes.deletedAt),
          ),
        )
        .orderBy(procedureTypes.name),
    ])

    const proceduresMap = await getProspectProceduresBatch(prospects.map((p) => p.id))
    const enriched = prospects.map((p) => ({
      ...p,
      interestedProcedures: proceduresMap[p.id] ?? [],
    }))

    return NextResponse.json({ data: enriched, stats, members, procedures })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()

    const tenant = await getTenant(ctx.tenantId)
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>
    if (!settings.whatsapp_enabled) {
      return NextResponse.json({ error: 'WhatsApp não está habilitado' }, { status: 403 })
    }
    const allowedRoles = (settings.whatsapp_allowed_roles as string[] | undefined) ?? ['owner']
    if (!allowedRoles.includes(ctx.role as Role) && ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
    }

    const gate = await subscriptionGate(ctx)
    if (gate) return gate

    const body = await request.json()
    const parsed = createProspectSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const prospect = await createProspect(ctx.tenantId, {
      phone: parsed.data.phone,
      name: parsed.data.name,
      source: parsed.data.source,
    })

    if (parsed.data.notes) {
      const { updateProspect } = await import('@/db/queries/prospects')
      await updateProspect(ctx.tenantId, prospect.id, { notes: parsed.data.notes })
    }

    await logProspectActivity(ctx.tenantId, prospect.id, 'created', {
      source: parsed.data.source,
    }, ctx.userId)

    await enqueueMetaEvent({
      tenantId: ctx.tenantId,
      eventName: 'Lead',
      eventId: `lead:${prospect.id}`,
      eventTime: new Date(),
      prospectId: prospect.id,
      contact: { phone: prospect.phone, fullName: prospect.name },
      actionSource: 'system_generated',
    })

    return NextResponse.json({ data: prospect }, { status: 201 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    const errCode = (error as Record<string, unknown>)?.code
    if (msg.includes('uq_prospects_tenant_phone') || (errCode === '23505' && msg.includes('prospects'))) {
      return NextResponse.json({ error: 'Já existe um lead com este telefone' }, { status: 409 })
    }
    return handleApiError(error, request)
  }
}
