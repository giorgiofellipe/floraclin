import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'
import { getSubscription } from '@/db/queries/subscriptions'
import { isReferralEnrollmentEnabled } from '@/lib/referral/config'
import { attributeReferral } from '@/lib/referral/attribution'

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!isReferralEnrollmentEnabled()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => null)
    const code = (body as { code?: unknown } | null)?.code

    const subscription = await getSubscription(ctx.tenantId)
    if (subscription?.firstPaidAt || subscription?.stripeSubscriptionId) {
      return NextResponse.json(
        { error: 'O código de indicação só pode ser informado antes do primeiro pagamento.' },
        { status: 400 },
      )
    }

    const result = await attributeReferral({ referredTenantId: ctx.tenantId, rawCode: code, capturedVia: 'billing_page' })

    if (result.outcome === 'created') return NextResponse.json({ status: result.status })

    switch (result.reason) {
      case 'already_attributed':
        return NextResponse.json({ error: 'Sua clínica já tem uma indicação registrada.' }, { status: 400 })
      case 'same_tenant':
        return NextResponse.json({ error: 'Você não pode usar o código da sua própria clínica.' }, { status: 400 })
      case 'disabled':
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      default:
        return NextResponse.json({ error: 'Código de indicação inválido ou inativo.' }, { status: 400 })
    }
  } catch (error) {
    return handleApiError(error, request)
  }
}
