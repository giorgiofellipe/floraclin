import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import {
  getClinicalDocumentWithContext,
  updateDeliveryStatus,
} from '@/db/queries/clinical-documents'
import {
  nextDeliveredViaAfterChannel,
  type DeliveryChannel,
} from '@/lib/clinical-documents'

const patchSchema = z.object({
  channel: z.enum(['print', 'download']),
})

/**
 * Marks the document as having been delivered through a non-WhatsApp channel
 * (print or PDF download). The UI calls this BEFORE opening the print/PDF URL
 * so the state machine reflects what the user actually did. WhatsApp delivery
 * stays on its dedicated endpoint because it has more side effects (PDF render,
 * storage upload, Meta call).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner', 'receptionist'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    // Tenant-scoped fetch — also gives us the previous deliveredVia.
    const doc = await getClinicalDocumentWithContext(ctx.tenantId, id)
    if (!doc) {
      return NextResponse.json({ error: 'Documento não encontrado' }, { status: 404 })
    }

    const channel = parsed.data.channel as DeliveryChannel
    const nextStatus = nextDeliveredViaAfterChannel(doc.deliveredVia, channel)

    if (nextStatus !== doc.deliveredVia) {
      await updateDeliveryStatus(ctx.tenantId, id, { deliveredVia: nextStatus })
      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'update',
        entityType: 'clinical_document',
        entityId: id,
        changes: {
          delivery: {
            old: { deliveredVia: doc.deliveredVia },
            new: { deliveredVia: nextStatus, channel },
          },
        },
      })
    }

    return NextResponse.json({ success: true, data: { deliveredVia: nextStatus } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Delivery PATCH error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
