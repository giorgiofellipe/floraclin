// web/src/app/api/consent/sign/route.ts
import { NextResponse } from 'next/server'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import { acceptConsent } from '@/db/queries/consent'
import { getValidSigningToken, markSigningTokenUsed, getTemplatesForToken } from '@/db/queries/consent-signing-tokens'
import { getPatient } from '@/db/queries/patients'
import { remoteConsentSignatureSchema } from '@/validations/consent'
import { handleApiError } from '@/lib/api-error'
import { isSubscriptionActive } from '@/lib/plans'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = remoteConsentSignatureSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const tokenData = await getValidSigningToken(parsed.data.token)
    if (!tokenData) {
      return NextResponse.json({ error: 'Link expirado ou já utilizado' }, { status: 410 })
    }

    // Gate on the tenant the token resolves to, not any session the caller
    // might hold. The patient may be signing while an unrelated clinic's
    // subscription is inactive; that must not block them.
    if (!(await isSubscriptionActive(tokenData.tenantId))) {
      return NextResponse.json(
        { error: 'Esta clínica não está aceitando assinaturas no momento.' },
        { status: 403 },
      )
    }

    const patient = await getPatient(tokenData.tenantId, tokenData.patientId)
    const signerCpf = patient?.cpf ?? ''

    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? request.headers.get('x-real-ip')
      ?? undefined
    const userAgent = request.headers.get('user-agent') ?? undefined

    const requiredIds = new Set(tokenData.consentTemplateIds as string[])
    const signedIds = new Set(parsed.data.signatures.map((s) => s.consentTemplateId))
    const complete = signedIds.size === requiredIds.size && [...signedIds].every((id) => requiredIds.has(id))
    if (!complete) {
      return NextResponse.json({ error: 'Assine todos os termos do link antes de enviar' }, { status: 400 })
    }

    const templates = await getTemplatesForToken(tokenData.tenantId, [...requiredIds])
    if (templates.length !== requiredIds.size) {
      return NextResponse.json({ error: 'Um dos termos deste link não está mais disponível' }, { status: 409 })
    }
    const renderedContents = (tokenData.renderedContents ?? {}) as Record<string, string>

    const acceptanceIds: string[] = []

    await withTransaction(async (tx) => {
      const used = await markSigningTokenUsed(parsed.data.token, tx)
      if (!used) {
        throw new Error('TOKEN_ALREADY_USED')
      }

      for (const sig of parsed.data.signatures) {
        const acceptance = await acceptConsent(
          tokenData.tenantId,
          {
            patientId: tokenData.patientId,
            consentTemplateId: sig.consentTemplateId,
            procedureRecordId: tokenData.procedureRecordId ?? undefined,
            acceptanceMethod: 'signature',
            signatureData: sig.signatureData,
          },
          {
            practitionerId: tokenData.createdBy,
            ipAddress,
            userAgent,
            signerCpf,
            renderedContent: renderedContents[sig.consentTemplateId] || undefined,
            deviceFingerprint: sig.deviceFingerprint,
            geolocation: sig.geolocation,
          },
          tx,
        )

        acceptanceIds.push(acceptance.id)

        await createAuditLog({
          tenantId: tokenData.tenantId,
          userId: tokenData.createdBy,
          action: 'consent_accepted',
          entityType: 'consent_acceptance',
          entityId: acceptance.id,
          changes: {
            method: { old: null, new: 'remote_whatsapp' },
            patientId: { old: null, new: tokenData.patientId },
            consentTemplateId: { old: null, new: sig.consentTemplateId },
          },
          ipAddress,
          userAgent,
        }, tx)
      }
    })

    return NextResponse.json({ success: true, acceptanceIds, signedAt: new Date().toISOString() })
  } catch (error) {
    if (error instanceof Error && error.message === 'TOKEN_ALREADY_USED') {
      return NextResponse.json({ error: 'Link expirado ou já utilizado' }, { status: 410 })
    }
    return handleApiError(error, request)
  }
}
