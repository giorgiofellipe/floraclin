import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import { acceptConsent } from '@/db/queries/consent'
import { consentAcceptanceSchema } from '@/validations/consent'

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
        ipAddress,
        userAgent,
        renderedContent: body.renderedContent,
      })

      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'consent_accepted',
        entityType: 'consent_acceptance',
        entityId: result.id,
        changes: {
          patientId: { old: null, new: body.patientId },
          consentTemplateId: { old: null, new: body.consentTemplateId },
          method: { old: null, new: body.acceptanceMethod },
        },
      }, tx)

      return result
    })

    return NextResponse.json({ success: true, data: acceptance })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
