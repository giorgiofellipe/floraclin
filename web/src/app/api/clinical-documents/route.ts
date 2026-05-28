import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { getPatient } from '@/db/queries/patients'
import {
  issueClinicalDocument,
  SignatureRequiredError,
} from '@/lib/clinical-documents'
import { issueClinicalDocumentSchema } from '@/validations/clinical-document'

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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
