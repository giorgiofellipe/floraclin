import { NextResponse } from 'next/server'
import { strToU8, zipSync } from 'fflate'
import { listNfseXmlForExport } from '@/db/queries/nfse'
import { handleApiError } from '@/lib/api-error'
import { requireRole } from '@/lib/auth'
import { nfseDocumentsFilterSchema } from '@/validations/nfse'

// One synchronous zip in memory: each NFS-e XML is a few KB.
const MAX_EXPORT_NOTES = 1000

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('owner', 'financial')
    const params = Object.fromEntries(new URL(request.url).searchParams)
    const parsed = nfseDocumentsFilterSchema.safeParse(params)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Filtros inválidos' }, { status: 400 })
    }
    const { dateFrom, dateTo } = parsed.data

    const notes = await listNfseXmlForExport(ctx.tenantId, parsed.data, MAX_EXPORT_NOTES + 1)
    if (notes.length === 0) {
      return NextResponse.json({ error: 'Nenhuma nota emitida no período para exportar.' }, { status: 404 })
    }
    if (notes.length > MAX_EXPORT_NOTES) {
      return NextResponse.json(
        { error: `Mais de ${MAX_EXPORT_NOTES} notas no período. Escolha um período menor.` },
        { status: 400 },
      )
    }

    const files: Record<string, Uint8Array> = {}
    for (const note of notes) {
      const preferred = `NFS-e-${note.nfseNumber ?? note.accessKey}.xml`
      const name = preferred in files ? `NFS-e-${note.accessKey}.xml` : preferred
      files[name] = strToU8(note.nfseXml!)
    }

    return new Response(Buffer.from(zipSync(files)), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="notas-fiscais-${dateFrom}-a-${dateTo}.zip"`,
      },
    })
  } catch (error) {
    return handleApiError(error, request)
  }
}
