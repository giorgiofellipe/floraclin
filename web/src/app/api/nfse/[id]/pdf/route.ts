import { NextResponse } from 'next/server'
import { renderDanfse } from '@bullcode/fiscal/nfse'
import { z } from 'zod'
import { getDocument } from '@/db/queries/nfse'
import { handleApiError } from '@/lib/api-error'
import { requireRole } from '@/lib/auth'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('owner', 'receptionist', 'financial')
    const { id } = await params

    const doc = z.guid().safeParse(id).success ? await getDocument(ctx.tenantId, id) : null
    if (!doc?.nfseXml || (doc.status !== 'issued' && doc.status !== 'cancelled')) {
      return NextResponse.json({ error: 'Nota não encontrada.' }, { status: 404 })
    }

    const pdf = await renderDanfse(doc.nfseXml)
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="NFS-e-${doc.nfseNumber ?? doc.accessKey}.pdf"`,
      },
    })
  } catch (error) {
    return handleApiError(error, request)
  }
}
