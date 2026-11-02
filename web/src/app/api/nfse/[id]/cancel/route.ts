import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDocument } from '@/db/queries/nfse'
import { handleApiError } from '@/lib/api-error'
import { BusinessError } from '@/lib/errors'
import { requireWrite } from '@/lib/write-access'
import { requestCancel } from '@/lib/nfse/emission'
import { nfseCancelSchema } from '@/validations/nfse'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'financial')
    if (blocked) return blocked
    const { id } = await params

    const parsed = nfseCancelSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    if (!z.guid().safeParse(id).success) {
      return NextResponse.json({ error: 'Nota não encontrada.', code: 'NFSE_NOT_FOUND' }, { status: 404 })
    }

    await requestCancel({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      documentId: id,
      reason: parsed.data.reason,
      justification: parsed.data.justification,
    })

    const doc = await getDocument(ctx.tenantId, id)
    return NextResponse.json({
      data: {
        id,
        status: doc?.status,
        cancelRequested: doc !== null && doc.cancelRequestedAt !== null && doc.status !== 'cancelled',
        errorMessage: doc?.errorMessage ?? null,
      },
    })
  } catch (error) {
    if (error instanceof BusinessError) {
      const status = error.code === 'NFSE_NOT_FOUND' ? 404 : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    return handleApiError(error, request)
  }
}
