import { NextResponse } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { recordFollowup } from '@/lib/followups'
import { recordFollowupSchema } from '@/validations/followup'
import { db } from '@/db/client'
import { procedureFollowups, procedureRecords, users } from '@/db/schema'
import { handleApiError } from '@/lib/api-error'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    const { id: procedureRecordId } = await params

    // Ensure caller's tenant owns this procedure record before exposing followups.
    const [owner] = await db
      .select({ id: procedureRecords.id })
      .from(procedureRecords)
      .where(
        and(
          eq(procedureRecords.id, procedureRecordId),
          eq(procedureRecords.tenantId, ctx.tenantId),
        ),
      )
      .limit(1)

    if (!owner) {
      return NextResponse.json({ error: 'Procedimento não encontrado' }, { status: 404 })
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
          eq(procedureFollowups.procedureRecordId, procedureRecordId),
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

    const { id: procedureRecordId } = await params
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
      result = await recordFollowup({
        tenantId: ctx.tenantId,
        contactedBy: ctx.userId,
        procedureRecordId,
        channel: parsed.data.channel,
        outcome: parsed.data.outcome,
        notes: parsed.data.notes,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg === 'Procedure not found') {
        return NextResponse.json({ error: 'Procedimento não encontrado' }, { status: 404 })
      }
      if (msg === 'Procedure cannot be cancelled from current status') {
        return NextResponse.json(
          {
            error:
              'Este planejamento não pode ser cancelado pelo registro de contato (status atual não permite).',
          },
          { status: 409 },
        )
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
            procedureRecordId,
            channel: parsed.data.channel,
            outcome: parsed.data.outcome,
            notes: parsed.data.notes ?? null,
          },
        },
        ...(result.cancelledProcedure
          ? {
              status: { old: null, new: 'cancelled' },
              cancellationReason: { old: null, new: 'patient_declined' },
            }
          : {}),
      },
    })

    // When the followup cancelled the procedure, emit a second audit entry
    // against the procedure_record itself so the procedure's audit trail
    // shows the cancellation event — not just a followup row. Matches the
    // shape used by the dedicated /cancel route.
    if (result.cancelledProcedure) {
      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'update',
        entityType: 'procedure_record',
        entityId: procedureRecordId,
        changes: {
          status: { old: result.previousStatus, new: 'cancelled' },
          cancellationReason: { old: null, new: 'patient_declined' },
        },
      })
    }

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    return handleApiError(error, request)
  }
}
