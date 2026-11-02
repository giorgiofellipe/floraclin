import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import {
  DiagramGroupLockedError,
  DiagramGroupNotFoundError,
  InvalidQuotationLineError,
  getDiagramGroup,
  updateStandaloneGroup,
} from '@/db/queries/face-diagram-groups'
import { updateDiagramGroupSchema } from '@/validations/face-diagram-group'
import { handleApiError } from '@/lib/api-error'

const NOT_FOUND = { error: 'Diagrama não encontrado' }

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    const { id } = await params
    const data = await getDiagramGroup(ctx.tenantId, id)
    if (!data) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ data })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked

    const { id } = await params
    const parsed = updateDiagramGroupSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    try {
      await withTransaction(async (tx) => {
        await updateStandaloneGroup(tx, {
          tenantId: ctx.tenantId,
          groupId: id,
          views: parsed.data.views,
          quotationLines: parsed.data.quotationLines,
        })
        await createAuditLog(
          {
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            action: 'update',
            entityType: 'face_diagram_group',
            entityId: id,
          },
          tx
        )
      })
    } catch (error) {
      if (error instanceof DiagramGroupNotFoundError) {
        return NextResponse.json({ error: error.message }, { status: 404 })
      }
      if (error instanceof DiagramGroupLockedError) {
        return NextResponse.json({ error: error.message }, { status: 409 })
      }
      if (error instanceof InvalidQuotationLineError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      throw error
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
