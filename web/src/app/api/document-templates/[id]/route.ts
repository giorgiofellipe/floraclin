import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import {
  getClinicalDocumentTemplate,
  updateClinicalDocumentTemplate,
  softDeleteClinicalDocumentTemplate,
} from '@/db/queries/clinical-documents'
import { updateClinicalDocumentTemplateSchema } from '@/validations/clinical-document'
import { handleApiError } from '@/lib/api-error'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked

    const { id } = await params
    const body = await request.json()
    const parsed = updateClinicalDocumentTemplateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const existing = await getClinicalDocumentTemplate(ctx.tenantId, id)
    if (!existing) {
      return NextResponse.json({ error: 'Modelo não encontrado' }, { status: 404 })
    }

    const updated = await updateClinicalDocumentTemplate(ctx.tenantId, id, parsed.data)
    if (!updated) {
      return NextResponse.json({ error: 'Falha ao atualizar modelo' }, { status: 500 })
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'clinical_document_template',
      entityId: id,
      changes: { template: { old: existing, new: parsed.data } },
    })

    return NextResponse.json({ data: updated })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked

    const { id } = await params
    const ok = await softDeleteClinicalDocumentTemplate(ctx.tenantId, id)
    if (!ok) {
      return NextResponse.json({ error: 'Modelo não encontrado' }, { status: 404 })
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'delete',
      entityType: 'clinical_document_template',
      entityId: id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
