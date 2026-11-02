import { NextResponse, type NextRequest } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { getDiagramQuote, markQuoteWhatsapp } from '@/db/queries/face-diagram-quotes'
import { getPatient } from '@/db/queries/patients'
import { getTenant } from '@/db/queries/tenants'
import { getSignedUrl } from '@/lib/storage'
import { sendOrEnqueueDocument } from '@/lib/whatsapp'
import { normalizeBrPhoneForWhatsApp } from '@/lib/phone'
import { firstName } from '@/lib/utils'
import { handleApiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner', 'receptionist')
    if (blocked) return blocked

    const { id } = await params
    const quote = await getDiagramQuote(ctx.tenantId, id)
    if (!quote) {
      return NextResponse.json({ error: 'Orçamento não encontrado' }, { status: 404 })
    }

    const patient = await getPatient(ctx.tenantId, quote.patientId)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }
    if (!patient.phone) {
      return NextResponse.json({ error: 'Paciente sem telefone cadastrado' }, { status: 400 })
    }
    const whatsappPhone = normalizeBrPhoneForWhatsApp(patient.phone)

    const url = await getSignedUrl(quote.storagePath, 3600)
    if (!url) {
      return NextResponse.json({ error: 'Falha ao gerar link do orçamento' }, { status: 500 })
    }

    const tenant = await getTenant(ctx.tenantId)
    const caption = `Orçamento - ${tenant?.name ?? ''}`.trim()
    const sendResult = await sendOrEnqueueDocument(
      ctx.tenantId,
      {
        actor: { type: 'user', userId: ctx.userId },
        recipient: { patientId: patient.id, name: patient.fullName },
        documentLabel: 'Orçamento',
      },
      whatsappPhone,
      firstName(patient.fullName),
      url,
      caption,
      'orcamento.pdf',
      quote.storagePath,
    )

    const status = sendResult.sent ? 'sent' : 'queued'
    const messageId = sendResult.metaMessageId ?? null
    await markQuoteWhatsapp(ctx.tenantId, id, { status, whatsappMessageId: messageId })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'face_diagram_quote',
      entityId: id,
      changes: {
        whatsappStatus: { old: quote.whatsappStatus, new: status },
      },
    })

    return NextResponse.json({
      success: true,
      data: { status, whatsappMessageId: messageId, queued: !sendResult.sent },
    })
  } catch (error) {
    return handleApiError(error, req, { body: { error: 'Falha ao enviar via WhatsApp' } })
  }
}
