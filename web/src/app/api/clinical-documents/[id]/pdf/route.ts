import { NextResponse, type NextRequest } from 'next/server'
import { createElement } from 'react'
import { getAuthContext } from '@/lib/auth'
import { getClinicalDocumentWithContext } from '@/db/queries/clinical-documents'
import { PrintDocument } from '@/components/clinical-documents/print-document'
import { renderReactToPdf, PRINT_BASE_CSS } from '@/lib/pdf'
import { fetchLogoDataUri } from '@/lib/logo'
import { handleApiError } from '@/lib/api-error'

export const runtime = 'nodejs'
// Disable body size limit / static optimization — this dynamically renders binary output.
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    const { id } = await params
    const doc = await getClinicalDocumentWithContext(ctx.tenantId, id)
    if (!doc) {
      return new NextResponse('Not found', { status: 404 })
    }

    // Inline the logo so headless Chromium makes no network request while
    // rendering; see `fetchLogoDataUri` (`@/lib/logo`).
    const tenant = { ...doc.tenant, logoUrl: await fetchLogoDataUri(doc.tenant.logoUrl) }

    const pdf = await renderReactToPdf(
      createElement(PrintDocument, { doc, tenant }),
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
    return handleApiError(error, req, { body: { error: 'Falha ao gerar PDF' } })
  }
}
