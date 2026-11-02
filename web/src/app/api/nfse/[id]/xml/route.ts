import { NextResponse } from 'next/server'
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

    return new Response(doc.nfseXml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="NFS-e-${doc.nfseNumber ?? doc.accessKey}.xml"`,
      },
    })
  } catch (error) {
    return handleApiError(error, request)
  }
}
