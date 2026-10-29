import { getTenantNames, type TenantReferral } from '@/db/queries/referrals'
import { notifyDiscord, type ReferralStatusParts } from '@/lib/discord'
import { reportSideEffectFailure } from '@/lib/observability'
import type { IneligibleReason, PausedReason, ReferralStatus } from './types'

export interface AnnounceDeps {
  tenantNames: typeof getTenantNames
  notifyDiscord: typeof notifyDiscord
  report: typeof reportSideEffectFailure
}

type StatusFields = Pick<TenantReferral, 'status' | 'pausedReason' | 'ineligibleReason'>

function statusParts(r: StatusFields): ReferralStatusParts {
  return {
    status: r.status as ReferralStatus,
    pausedReason: (r.pausedReason as PausedReason | null) ?? null,
    ineligibleReason: (r.ineligibleReason as IneligibleReason | null) ?? null,
  }
}

/** Posts referral.status_changed to Discord. Call only after the change is persisted; never throws. */
export async function announceReferralStatusChange(
  before: Pick<TenantReferral, 'id' | 'referrerTenantId' | 'referredTenantId'> & StatusFields,
  after: StatusFields,
  opts: { note?: string | null } = {},
  deps: Partial<AnnounceDeps> = {},
): Promise<void> {
  const d: AnnounceDeps = {
    tenantNames: deps.tenantNames ?? getTenantNames,
    notifyDiscord: deps.notifyDiscord ?? notifyDiscord,
    report: deps.report ?? reportSideEffectFailure,
  }
  try {
    const names = await d.tenantNames([before.referrerTenantId, before.referredTenantId])
    await d.notifyDiscord({
      kind: 'referral.status_changed',
      referrerName: names[before.referrerTenantId] ?? before.referrerTenantId,
      referrerTenantId: before.referrerTenantId,
      referredName: names[before.referredTenantId] ?? before.referredTenantId,
      referredTenantId: before.referredTenantId,
      from: statusParts(before),
      to: statusParts(after),
      note: opts.note ?? null,
    })
  } catch (err) {
    d.report(err, { area: 'referral', step: 'discord_status_changed', extra: { referralId: before.id } })
  }
}
