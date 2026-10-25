import { NextResponse, type NextRequest } from 'next/server'
import { createElement } from 'react'
import { getConsentAcceptanceWithContext } from '@/db/queries/consent'
import { isSubscriptionActive } from '@/lib/plans'
import { getRecentlyUsedSigningToken, claimPatientCopy, releasePatientCopy } from '@/db/queries/consent-signing-tokens'
import { PrintConsent } from '@/components/consent/print-consent'
import { renderReactToPdf, PRINT_BASE_CSS } from '@/lib/pdf'
import { fetchLogoDataUri } from '@/lib/logo'
import { uploadPdfBuffer } from '@/lib/storage'
import { sendOrEnqueueDocument } from '@/lib/whatsapp'
import { auth } from '@/lib/auth-config'
import { db } from '@/db/client'
import { consentAcceptances, tenantUsers, users } from '@/db/schema'
import { signedInBeforePasswordChange } from '@/lib/auth'
import { eq, and } from 'drizzle-orm'
import { normalizeBrPhoneForWhatsApp } from '@/lib/phone'
import { handleApiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Requester = { tenantId: string; userId: string | null; claimedCopy: boolean }

async function resolveRequester(req: NextRequest, acceptanceId: string): Promise<Requester | null> {
  // Path 1: logged-in user with membership in the acceptance's tenant
  const session = await auth()
  if (session?.user?.id) {
    const [row] = await db
      .select({ tenantId: consentAcceptances.tenantId, passwordChangedAt: users.passwordChangedAt })
      .from(consentAcceptances)
      .innerJoin(tenantUsers, and(
        eq(tenantUsers.tenantId, consentAcceptances.tenantId),
        eq(tenantUsers.userId, session.user.id),
        eq(tenantUsers.isActive, true),
      ))
      .innerJoin(users, eq(users.id, tenantUsers.userId))
      .where(eq(consentAcceptances.id, acceptanceId))
      .limit(1)
    if (row && !signedInBeforePasswordChange((session as { authAt?: number }).authAt, row.passwordChangedAt)) {
      return { tenantId: row.tenantId, userId: session.user.id, claimedCopy: false }
    }
  }

  // Path 2: signing token (valid for 1h after use/expiry)
  const signingToken = req.nextUrl.searchParams.get('token')
  if (signingToken) {
    const tokenData = await getRecentlyUsedSigningToken(signingToken)
    if (tokenData) {
      const claimed = await claimPatientCopy(acceptanceId, tokenData.id)
      if (claimed) return { tenantId: claimed.tenantId, userId: null, claimedCopy: true }
    }
  }

  return null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let requester: Requester | null = null
  let delivered = false
  try {
    requester = await resolveRequester(req, id)
    if (!requester) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const tenantId = requester.tenantId

    // Gated here rather than through `requireWrite`, because
    // `resolveRequester` accepts either a session or a capability
    // token and there may be no session at all. Checked against the tenant
    // the request resolved to, never the caller's own: someone whose own
    // clinic has lapsed must still be able to act on an active clinic that
    // sent them a link.
    if (!(await isSubscriptionActive(tenantId))) {
      return NextResponse.json(
        { error: 'Esta clínica não está aceitando envios no momento.' },
        { status: 403 },
      )
    }

    const acceptance = await getConsentAcceptanceWithContext(tenantId, id)
    if (!acceptance) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (!acceptance.patientPhone) {
      return NextResponse.json({ error: 'Paciente sem telefone cadastrado' }, { status: 400 })
    }
    const whatsappPhone = normalizeBrPhoneForWhatsApp(acceptance.patientPhone)

    // Inline the logo so headless Chromium makes no network request while
    // rendering; see `fetchLogoDataUri` (`@/lib/logo`).
    const tenantLogoUrl = await fetchLogoDataUri(acceptance.tenantLogoUrl)

    const pdfBuffer = await renderReactToPdf(
      createElement(PrintConsent, { acceptance: { ...acceptance, tenantLogoUrl } }),
      PRINT_BASE_CSS,
    )

    const fileName = `termos/${id}-${slugifyForFile(acceptance.templateTitle)}.pdf`
    const { url, path: storagePath } = await uploadPdfBuffer({
      tenantId,
      patientId: acceptance.patientId,
      fileName,
      buffer: Buffer.from(pdfBuffer),
      visibility: 'signed',
    })

    const firstName = acceptance.patientName.split(' ')[0]
    const whatsappFilename = `${slugifyForFile(acceptance.templateTitle)}.pdf`
    await sendOrEnqueueDocument(
      tenantId,
      {
        actor: requester.userId ? { type: 'user', userId: requester.userId } : { type: 'patient' },
        recipient: { patientId: acceptance.patientId, name: acceptance.patientName },
        documentLabel: acceptance.templateTitle,
      },
      whatsappPhone,
      firstName,
      url,
      `${acceptance.templateTitle} — FloraClin`,
      whatsappFilename,
      storagePath,
    )

    delivered = true
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, req, { body: { error: 'Falha ao enviar via WhatsApp' } })
  } finally {
    // A failed send gives the patient their one copy back to retry.
    if (requester?.claimedCopy && !delivered) await releasePatientCopy(id)
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
