import { NextResponse } from 'next/server'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import {
  DIAGRAM_NOT_AWAITING,
  DIAGRAM_NOT_FOUND,
  recordDiagramFollowup,
} from '@/lib/followups'
import { recordFollowupSchema } from '@/validations/followup'
import { db } from '@/db/client'
import { faceDiagramGroups, procedureFollowups, users } from '@/db/schema'
import { handleApiError } from '@/lib/api-error'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    const { id: groupId } = await params

    const [owner] = await db
      .select({ id: faceDiagramGroups.id })
      .from(faceDiagramGroups)
      .where(
        and(
          eq(faceDiagramGroups.id, groupId),
          eq(faceDiagramGroups.tenantId, ctx.tenantId),
          isNull(faceDiagramGroups.deletedAt),
        ),
      )
      .limit(1)

    if (!owner) {
      return NextResponse.json({ error: 'Orçamento não encontrado' }, { status: 404 })
    }

    const rows = await db
      .select({
        id: procedureFollowups.id,
        contactedAt: procedureFollowups.contactedAt,
        contactedById: procedureFollowups.contactedBy,
        contactedByName: users.fullName,
        channel: procedureFollowups.channel,
        outcome: procedureFollowups.outcome,
        notes: procedureFollowups.notes,
      })
      .from(procedureFollowups)
      .innerJoin(users, eq(procedureFollowups.contactedBy, users.id))
      .where(
        and(
          eq(procedureFollowups.faceDiagramGroupId, groupId),
          eq(procedureFollowups.tenantId, ctx.tenantId),
        ),
      )
      .orderBy(desc(procedureFollowups.contactedAt))

    return NextResponse.json({ data: rows })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner', 'receptionist')
    if (blocked) return blocked

    const { id: groupId } = await params
    const body = await request.json().catch(() => ({}))
    const parsed = recordFollowupSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    let result
    try {
      result = await recordDiagramFollowup({
        tenantId: ctx.tenantId,
        groupId,
        userId: ctx.userId,
        channel: parsed.data.channel,
        outcome: parsed.data.outcome,
        notes: parsed.data.notes,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg === DIAGRAM_NOT_FOUND) {
        return NextResponse.json({ error: 'Orçamento não encontrado' }, { status: 404 })
      }
      if (msg === DIAGRAM_NOT_AWAITING) {
        return NextResponse.json({ error: 'Este orçamento não está mais aguardando' }, { status: 409 })
      }
      throw err
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'procedure_followup',
      entityId: result.followupId,
      changes: {
        followup: {
          old: null,
          new: {
            faceDiagramGroupId: groupId,
            channel: parsed.data.channel,
            outcome: parsed.data.outcome,
            notes: parsed.data.notes ?? null,
          },
        },
        ...(result.declined ? { declinedAt: { old: null, new: 'now' } } : {}),
      },
    })

    return NextResponse.json({
      success: true,
      data: { followupId: result.followupId, cancelledProcedure: result.declined },
    })
  } catch (error) {
    return handleApiError(error, request)
  }
}
