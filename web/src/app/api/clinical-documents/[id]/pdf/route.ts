import { NextResponse, type NextRequest } from 'next/server'
import { createElement } from 'react'
import { getAuthContext } from '@/lib/auth'
import { getClinicalDocumentWithContext } from '@/db/queries/clinical-documents'
import { PrintDocument } from '@/components/clinical-documents/print-document'
import { renderReactToPdf, PRINT_BASE_CSS } from '@/lib/pdf'

export const runtime = 'nodejs'
// Disable body size limit / static optimization — this dynamically renders binary output.
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    const { id } = await params
    const doc = await getClinicalDocumentWithContext(ctx.tenantId, id)
    if (!doc) {
      return new NextResponse('Not found', { status: 404 })
    }

    const pdf = await renderReactToPdf(
      createElement(PrintDocument, { doc, tenant: doc.tenant }),
      PRINT_BASE_CSS,
    )

    // Use Uint8Array view so the Response body type is correct.
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${doc.kind}-${id}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('PDF render error:', error)
    return NextResponse.json({ error: 'Falha ao gerar PDF' }, { status: 500 })
  }
}
