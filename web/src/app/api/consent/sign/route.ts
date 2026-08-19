// web/src/app/api/consent/sign/route.ts
import { NextResponse } from 'next/server'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import { acceptConsent } from '@/db/queries/consent'
import { getValidSigningToken, markSigningTokenUsed, getTemplatesForToken } from '@/db/queries/consent-signing-tokens'
import { getPatient } from '@/db/queries/patients'
import { remoteConsentSignatureSchema } from '@/validations/consent'
import { handleApiError } from '@/lib/api-error'

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

    const patient = await getPatient(tokenData.tenantId, tokenData.patientId)
    const signerCpf = patient?.cpf ?? ''

    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? request.headers.get('x-real-ip')
      ?? undefined
    const userAgent = request.headers.get('user-agent') ?? undefined

    const templates = await getTemplatesForToken(tokenData.tenantId, tokenData.consentTemplateIds as string[])
    const templateMap = new Map(templates.map((t) => [t.id, t]))
    const renderedContents = (tokenData.renderedContents ?? {}) as Record<string, string>

    const acceptanceIds: string[] = []

    await withTransaction(async (tx) => {
      const used = await markSigningTokenUsed(parsed.data.token, tx)
      if (!used) {
        throw new Error('TOKEN_ALREADY_USED')
      }

      for (const sig of parsed.data.signatures) {
        const template = templateMap.get(sig.consentTemplateId)
        if (!template) continue

        const acceptance = await acceptConsent(
          tokenData.tenantId,
          {
            patientId: tokenData.patientId,
            consentTemplateId: sig.consentTemplateId,
            procedureRecordId: tokenData.procedureRecordId,
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
