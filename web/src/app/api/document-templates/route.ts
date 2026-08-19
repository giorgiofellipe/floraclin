import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import {
  listClinicalDocumentTemplates,
  createClinicalDocumentTemplate,
} from '@/db/queries/clinical-documents'
import {
  clinicalDocumentTemplateSchema,
  CLINICAL_DOCUMENT_KINDS,
} from '@/validations/clinical-document'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)
    const kindParam = searchParams.get('kind')
    const includeInactive = searchParams.get('includeInactive') === 'true'

    const kind =
      kindParam && (CLINICAL_DOCUMENT_KINDS as readonly string[]).includes(kindParam)
        ? (kindParam as (typeof CLINICAL_DOCUMENT_KINDS)[number])
        : undefined

    const templates = await listClinicalDocumentTemplates(ctx.tenantId, {
      kind,
      includeInactive,
    })
    return NextResponse.json({ data: templates })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = clinicalDocumentTemplateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const template = await createClinicalDocumentTemplate({
      tenantId: ctx.tenantId,
      createdBy: ctx.userId,
      kind: parsed.data.kind,
      name: parsed.data.name,
      body: parsed.data.body,
      isActive: parsed.data.isActive,
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'clinical_document_template',
      entityId: template.id,
      changes: { template: { old: null, new: parsed.data } },
    })

    return NextResponse.json({ data: template })
  } catch (error) {
    return handleApiError(error, request)
  }
}
