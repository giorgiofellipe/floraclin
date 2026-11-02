import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDocument } from '@/db/queries/nfse'
import { handleApiError } from '@/lib/api-error'
import { requireWrite } from '@/lib/write-access'
import { BusinessError } from '@/lib/errors'
import { sendNfseEmail } from '@/lib/nfse/nfse-email'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'receptionist', 'financial')
    if (blocked) return blocked
    const { id } = await params

    const doc = z.guid().safeParse(id).success ? await getDocument(ctx.tenantId, id) : null
    if (!doc || doc.status !== 'issued') {
      return NextResponse.json({ error: 'Nota não encontrada.' }, { status: 404 })
    }

    try {
      await sendNfseEmail(id)
    } catch (error) {
      if (error instanceof BusinessError && error.code === 'PATIENT_EMAIL_MISSING') {
        return NextResponse.json(
          { error: 'O paciente não tem email cadastrado.', code: error.code },
          { status: 409 },
        )
      }
      throw error
    }

    const updated = await getDocument(ctx.tenantId, id)
    return NextResponse.json({ data: { id, emailSentAt: updated?.emailSentAt?.toISOString() ?? null } })
  } catch (error) {
    return handleApiError(error, request)
  }
}
