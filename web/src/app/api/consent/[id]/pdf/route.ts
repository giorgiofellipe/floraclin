import { NextResponse, type NextRequest } from 'next/server'
import { createElement } from 'react'
import { getAuthContext } from '@/lib/auth'
import { getConsentAcceptanceWithContext } from '@/db/queries/consent'
import { PrintConsent } from '@/components/consent/print-consent'
import { renderReactToPdf, PRINT_BASE_CSS } from '@/lib/pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    const { id } = await params
    const acceptance = await getConsentAcceptanceWithContext(ctx.tenantId, id)
    if (!acceptance) {
      return new NextResponse('Not found', { status: 404 })
    }

    const pdf = await renderReactToPdf(
      createElement(PrintConsent, { acceptance }),
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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Consent PDF render error:', error)
    return NextResponse.json({ error: 'Falha ao gerar PDF' }, { status: 500 })
  }
}
