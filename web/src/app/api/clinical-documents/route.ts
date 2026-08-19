import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { getPatient } from '@/db/queries/patients'
import { getClinicalDocumentTemplate } from '@/db/queries/clinical-documents'
import {
  issueClinicalDocument,
  SignatureRequiredError,
} from '@/lib/clinical-documents'
import { issueClinicalDocumentSchema } from '@/validations/clinical-document'
import { handleApiError } from '@/lib/api-error'

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = issueClinicalDocumentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    // Tenant guard on patient
    const patient = await getPatient(ctx.tenantId, parsed.data.patientId)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    // Tenant guard on template (if provided). Without this check, a malicious
    // client could pass a templateId from another clinic — FK alone won't stop
    // that, only tenant scoping does. We also enforce kind match so a 'receita'
    // template can't be referenced by an 'atestado' document.
    if (parsed.data.templateId) {
      const template = await getClinicalDocumentTemplate(
        ctx.tenantId,
        parsed.data.templateId,
      )
      if (!template) {
        return NextResponse.json(
          { error: 'Modelo não encontrado' },
          { status: 404 },
        )
      }
      if (template.kind !== parsed.data.kind) {
        return NextResponse.json(
          { error: 'Modelo não corresponde ao tipo do documento' },
          { status: 400 },
        )
      }
    }

    const doc = await issueClinicalDocument({
      tenantId: ctx.tenantId,
      practitionerId: ctx.userId,
      patientId: parsed.data.patientId,
      kind: parsed.data.kind,
      title: parsed.data.title,
      body: parsed.data.body,
      templateId: parsed.data.templateId ?? null,
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'clinical_document',
      entityId: doc.id,
      changes: {
        document: {
          old: null,
          new: { kind: doc.kind, title: doc.title, patientId: doc.patientId },
        },
      },
    })

    return NextResponse.json({ data: { id: doc.id } })
  } catch (error) {
    if (error instanceof SignatureRequiredError) {
      return NextResponse.json(
        { error: error.message, code: 'signature_required' },
        { status: 412 },
      )
    }
    return handleApiError(error, request)
  }
}
