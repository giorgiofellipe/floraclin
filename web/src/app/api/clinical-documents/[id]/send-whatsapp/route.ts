import { NextResponse, type NextRequest } from 'next/server'
import { createElement } from 'react'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import {
  getClinicalDocumentWithContext,
  updateDeliveryStatus,
} from '@/db/queries/clinical-documents'
import { PrintDocument } from '@/components/clinical-documents/print-document'
import { renderReactToPdf, PRINT_BASE_CSS } from '@/lib/pdf'
import { uploadPdfBuffer } from '@/lib/storage'
import { sendMediaMessage } from '@/lib/whatsapp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function slugifyForFile(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || 'documento'
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner', 'receptionist'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const doc = await getClinicalDocumentWithContext(ctx.tenantId, id)
    if (!doc) {
      return NextResponse.json({ error: 'Documento não encontrado' }, { status: 404 })
    }

    if (!doc.patient.phone) {
      return NextResponse.json(
        { error: 'Paciente sem telefone cadastrado' },
        { status: 400 },
      )
    }

    // 1. Render PDF
    const pdfBuffer = await renderReactToPdf(
      createElement(PrintDocument, { doc, tenant: doc.tenant }),
      PRINT_BASE_CSS,
    )

    // 2. Upload + sign URL
    const safeKind = slugifyForFile(doc.kind)
    const safeTitle = slugifyForFile(doc.title)
    const fileName = `documents/${id}-${safeKind}-${safeTitle}.pdf`
    const { url, path: storagePath } = await uploadPdfBuffer({
      tenantId: ctx.tenantId,
      patientId: doc.patientId,
      fileName,
      buffer: pdfBuffer,
      visibility: 'signed',
    })

    // 3. Send via WhatsApp
    // Use a sanitized filename so the patient sees a clean ".pdf" attachment
    // name in WhatsApp instead of the raw storage path.
    const whatsappFilename = `${slugifyForFile(doc.title)}.pdf`
    const sendResult = await sendMediaMessage(
      ctx.tenantId,
      doc.patient.phone,
      'document',
      url,
      doc.title,
      whatsappFilename,
    )

    // 4. Persist delivery status — only WhatsApp sends count as "delivered".
    await updateDeliveryStatus(ctx.tenantId, id, {
      deliveredVia: 'whatsapp',
      whatsappMessageId: sendResult.metaMessageId ?? null,
      storagePath,
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'clinical_document',
      entityId: id,
      changes: {
        delivery: {
          old: { deliveredVia: doc.deliveredVia },
          new: {
            deliveredVia: 'whatsapp',
            whatsappMessageId: sendResult.metaMessageId ?? null,
          },
        },
      },
    })

    return NextResponse.json({
      success: true,
      data: { deliveredVia: 'whatsapp', whatsappMessageId: sendResult.metaMessageId ?? null },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Send WhatsApp error:', error)
    return NextResponse.json(
      { error: msg || 'Falha ao enviar via WhatsApp' },
      { status: 500 },
    )
  }
}
