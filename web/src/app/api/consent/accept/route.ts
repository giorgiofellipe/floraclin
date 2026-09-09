import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import { acceptConsent } from '@/db/queries/consent'
import { consentAcceptanceSchema } from '@/validations/consent'
import { handleApiError } from '@/lib/api-error'

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked

    const body = await request.json()
    const parsed = consentAcceptanceSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? request.headers.get('x-real-ip')
      ?? undefined
    const userAgent = request.headers.get('user-agent') ?? undefined

    const acceptance = await withTransaction(async (tx) => {
      const result = await acceptConsent(ctx.tenantId, parsed.data, {
        practitionerId: ctx.userId,
        ipAddress,
        userAgent,
        renderedContent: parsed.data.renderedContent,
        signerCpf: parsed.data.signerCpf,
        deviceFingerprint: parsed.data.deviceFingerprint,
        geolocation: parsed.data.geolocation,
      }, tx)

      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'consent_accepted',
        entityType: 'consent_acceptance',
        entityId: result.id,
        changes: {
          patientId: { old: null, new: parsed.data.patientId },
          consentTemplateId: { old: null, new: parsed.data.consentTemplateId },
          method: { old: null, new: parsed.data.acceptanceMethod },
        },
      }, tx)

      return result
    })

    return NextResponse.json({ success: true, data: acceptance })
  } catch (error) {
    return handleApiError(error, request)
  }
}
