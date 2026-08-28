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
import { fetchLogoDataUri } from '@/lib/logo'
import { uploadPdfBuffer } from '@/lib/storage'
import { sendOrEnqueueDocument } from '@/lib/whatsapp'
import { toWhatsAppPhone } from '@/lib/phone'
import { handleApiError } from '@/lib/api-error'

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
  req: NextRequest,
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
    // Inline the logo so headless Chromium makes no network request while
    // rendering; see `fetchLogoDataUri` (`@/lib/logo`).
    const tenant = { ...doc.tenant, logoUrl: await fetchLogoDataUri(doc.tenant.logoUrl) }

    const pdfBuffer = await renderReactToPdf(
      createElement(PrintDocument, { doc, tenant }),
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
    const whatsappPhone = toWhatsAppPhone(doc.patient.phone)
    const firstName = doc.patient.fullName.split(' ')[0]
    const whatsappFilename = `${slugifyForFile(doc.title)}.pdf`
    const sendResult = await sendOrEnqueueDocument(
      ctx.tenantId,
      whatsappPhone,
      firstName,
      url,
      doc.title,
      whatsappFilename,
      storagePath,
    )

    // 4. Persist delivery status
    const deliveredVia = sendResult.sent ? 'whatsapp' : 'pending'
    const messageId = sendResult.metaMessageId ?? null
    await updateDeliveryStatus(ctx.tenantId, id, {
      deliveredVia,
      whatsappMessageId: messageId,
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
          new: { deliveredVia, whatsappMessageId: messageId },
        },
      },
    })

    return NextResponse.json({
      success: true,
      data: { deliveredVia, whatsappMessageId: messageId, queued: !!sendResult.queued },
    })
  } catch (error) {
    return handleApiError(error, req, { body: { error: 'Falha ao enviar via WhatsApp' } })
  }
}
