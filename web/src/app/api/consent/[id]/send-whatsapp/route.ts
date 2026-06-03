import { NextResponse, type NextRequest } from 'next/server'
import { createElement } from 'react'
import { getConsentAcceptanceWithContext } from '@/db/queries/consent'
import { getRecentlyUsedSigningToken } from '@/db/queries/consent-signing-tokens'
import { PrintConsent } from '@/components/consent/print-consent'
import { renderReactToPdf, PRINT_BASE_CSS } from '@/lib/pdf'
import { uploadPdfBuffer } from '@/lib/storage'
import { sendOrEnqueueDocument } from '@/lib/whatsapp'
import { auth } from '@/lib/auth-config'
import { db } from '@/db/client'
import { consentAcceptances, tenantUsers } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { toWhatsAppPhone } from '@/lib/phone'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function resolveAuthorizedTenantId(req: NextRequest, acceptanceId: string): Promise<string | null> {
  // Path 1: logged-in user with membership in the acceptance's tenant
  const session = await auth()
  if (session?.user?.id) {
    const [row] = await db
      .select({ tenantId: consentAcceptances.tenantId })
      .from(consentAcceptances)
      .innerJoin(tenantUsers, and(
        eq(tenantUsers.tenantId, consentAcceptances.tenantId),
        eq(tenantUsers.userId, session.user.id),
        eq(tenantUsers.isActive, true),
      ))
      .where(eq(consentAcceptances.id, acceptanceId))
      .limit(1)
    if (row) return row.tenantId
  }

  // Path 2: signing token (valid for 1h after use/expiry)
  const signingToken = req.nextUrl.searchParams.get('token')
  if (signingToken) {
    const tokenData = await getRecentlyUsedSigningToken(signingToken)
    if (tokenData) {
      const [row] = await db
        .select({ tenantId: consentAcceptances.tenantId })
        .from(consentAcceptances)
        .where(and(eq(consentAcceptances.id, acceptanceId), eq(consentAcceptances.tenantId, tokenData.tenantId)))
        .limit(1)
      if (row) return row.tenantId
    }
  }

  return null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    const tenantId = await resolveAuthorizedTenantId(req, id)
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const acceptance = await getConsentAcceptanceWithContext(tenantId, id)
    if (!acceptance) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (!acceptance.patientPhone) {
      return NextResponse.json({ error: 'Paciente sem telefone cadastrado' }, { status: 400 })
    }

    const pdfBuffer = await renderReactToPdf(
      createElement(PrintConsent, { acceptance }),
      PRINT_BASE_CSS,
    )

    const fileName = `termos/${id}-${slugifyForFile(acceptance.templateTitle)}.pdf`
    const { url } = await uploadPdfBuffer({
      tenantId,
      patientId: acceptance.patientId,
      fileName,
      buffer: Buffer.from(pdfBuffer),
      visibility: 'signed',
    })

    const whatsappPhone = toWhatsAppPhone(acceptance.patientPhone)
    const firstName = acceptance.patientName.split(' ')[0]
    const whatsappFilename = `${slugifyForFile(acceptance.templateTitle)}.pdf`
    await sendOrEnqueueDocument(
      tenantId,
      whatsappPhone,
      firstName,
      url,
      `${acceptance.templateTitle} — FloraClin`,
      whatsappFilename,
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Consent WhatsApp send error:', error)
    return NextResponse.json({ error: 'Falha ao enviar via WhatsApp' }, { status: 500 })
  }
}

function slugifyForFile(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || 'termo'
}
