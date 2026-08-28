import { NextResponse, type NextRequest } from 'next/server'
import { createElement } from 'react'
import { getAuthContext } from '@/lib/auth'
import { getConsentAcceptanceWithContext } from '@/db/queries/consent'
import { PrintConsent } from '@/components/consent/print-consent'
import { renderReactToPdf, PRINT_BASE_CSS } from '@/lib/pdf'
import { fetchLogoDataUri } from '@/lib/logo'
import { handleApiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    const { id } = await params
    const acceptance = await getConsentAcceptanceWithContext(ctx.tenantId, id)
    if (!acceptance) {
      return new NextResponse('Not found', { status: 404 })
    }

    // Inline the logo so headless Chromium makes no network request while
    // rendering; see `fetchLogoDataUri` (`@/lib/logo`).
    const tenantLogoUrl = await fetchLogoDataUri(acceptance.tenantLogoUrl)

    const pdf = await renderReactToPdf(
      createElement(PrintConsent, { acceptance: { ...acceptance, tenantLogoUrl } }),
      PRINT_BASE_CSS,
    )

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="termo-${id}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    return handleApiError(error, req, { body: { error: 'Falha ao gerar PDF' } })
  }
}
