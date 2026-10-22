import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import type { AuthContext } from '@/types'
import { requireWrite } from '@/lib/write-access'
import { handleApiError } from '@/lib/api-error'
import { getSubscription } from '@/db/queries/subscriptions'
import { isReferralCodeAvailable, updateReferralCode } from '@/db/queries/referrals'
import { canRefer, isReferralEnrollmentEnabled } from '@/lib/referral/config'
import { CUSTOM_CODE_MESSAGES, validateCustomReferralCode } from '@/lib/referral/custom-code'

type Gate = { ok: true; tenantId: string; userId: string } | { ok: false; response: NextResponse }

/** Owner of a clinic that can refer (Stripe, active), with the program on. Everything is scoped to ctx.tenantId. */
async function gate(ctx: Pick<AuthContext, 'role' | 'tenantId' | 'userId'>): Promise<Gate> {
  if (ctx.role !== 'owner') return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  if (!isReferralEnrollmentEnabled()) {
    return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }
  if (!canRefer(await getSubscription(ctx.tenantId))) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Seu código de indicação fica ativo quando sua clínica tem uma assinatura paga.' },
        { status: 403 },
      ),
    }
  }
  return { ok: true, tenantId: ctx.tenantId, userId: ctx.userId }
}

/** Live availability check for the editor: GET /api/referral/code?code=DRAMICAELA */
export async function GET(request: Request) {
  try {
    const g = await gate(await getAuthContext())
    if (!g.ok) return g.response
    const validation = validateCustomReferralCode(new URL(request.url).searchParams.get('code'))
    if (!validation.ok) {
      return NextResponse.json({ available: false, reason: validation.reason, message: validation.message })
    }
    const available = await isReferralCodeAvailable(g.tenantId, validation.code)
    return NextResponse.json(
      available
        ? { available: true, code: validation.code }
        : { available: false, reason: 'taken', message: CUSTOM_CODE_MESSAGES.taken },
    )
  } catch (error) {
    return handleApiError(error, request)
  }
}

/** Saves a new code: PUT { code }. The old code and link keep working for this clinic (referral_code_aliases). */
export async function PUT(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked
    const g = await gate(ctx)
    if (!g.ok) return g.response
    const body = await request.json().catch(() => null)
    const validation = validateCustomReferralCode((body as { code?: unknown } | null)?.code)
    if (!validation.ok) return NextResponse.json({ error: validation.message }, { status: 400 })

    const result = await updateReferralCode({ tenantId: g.tenantId, userId: g.userId, code: validation.code })
    switch (result.outcome) {
      case 'updated':
      case 'unchanged':
        return NextResponse.json({ code: result.code })
      case 'taken':
        return NextResponse.json({ error: CUSTOM_CODE_MESSAGES.taken }, { status: 409 })
      case 'rate_limited':
        return NextResponse.json({ error: CUSTOM_CODE_MESSAGES.rateLimited }, { status: 429 })
      case 'alias_limit':
        return NextResponse.json({ error: CUSTOM_CODE_MESSAGES.aliasLimit }, { status: 409 })
    }
  } catch (error) {
    return handleApiError(error, request)
  }
}
