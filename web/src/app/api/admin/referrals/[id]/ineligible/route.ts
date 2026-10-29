import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePlatformAdmin } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'
import { createAuditLog } from '@/lib/audit'
import { reportSideEffectFailure } from '@/lib/observability'
import { getReferralById, markReferralIneligible } from '@/db/queries/referrals'
import { syncReferrerReward } from '@/lib/referral/reward'
import { announceReferralStatusChange } from '@/lib/referral/announce'

const bodySchema = z.object({ note: z.string().trim().max(500).optional() })

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin()
    const { id } = await params

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Motivo inválido (máximo de 500 caracteres)' }, { status: 400 })
    }

    const existing = await getReferralById(id)
    if (!existing) {
      return NextResponse.json({ error: 'Indicação não encontrada' }, { status: 404 })
    }

    const referral = await markReferralIneligible(id, 'admin', parsed.data.note || undefined)
    if (!referral) {
      return NextResponse.json({ error: 'Esta indicação já está marcada como não elegível' }, { status: 409 })
    }

    await createAuditLog({
      tenantId: referral.referredTenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'tenant_referral',
      entityId: id,
      changes: { status: { old: existing.status, new: 'ineligible' } },
    })

    await announceReferralStatusChange(existing, referral, { note: parsed.data.note || null })

    // The mark is already persisted, so a sync failure must not answer 500 (a retry would get 409);
    // the next webhook or the daily reconcile corrects the discount.
    try {
      await syncReferrerReward(referral.referrerTenantId, { reason: 'admin', referralId: id })
    } catch (err) {
      reportSideEffectFailure(err, { area: 'referral', step: 'admin_ineligible_sync', extra: { referralId: id } })
    }

    return NextResponse.json({ data: { status: 'ineligible' } })
  } catch (error) {
    return handleApiError(error, req)
  }
}
