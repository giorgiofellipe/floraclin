import { BusinessError } from '@/lib/errors'
import { findPlatformTemplate } from '@/lib/platform-whatsapp'

/**
 * Whether a lifecycle WhatsApp template can be sent right now, asked of Meta
 * instead of a flag in code, so a key starts going out by WhatsApp on its own
 * as soon as Meta approves its template.
 *
 * - `approved`: Meta reports APPROVED.
 * - `not_approved`: Meta reports another status (PENDING, REJECTED, PAUSED,
 *   ...) or has no pt_BR template with this name (`MISSING`).
 * - `unknown`: the lookup itself failed (timeout, Meta error, missing env).
 *   `code` is the BusinessError code when there is one (e.g.
 *   WHATSAPP_NOT_CONFIGURED). The caller fails open on this one: see
 *   deliverLifecycleMessage.
 */
export type LifecycleTemplateApproval =
  | { state: 'approved' }
  | { state: 'not_approved'; status: string }
  | { state: 'unknown'; error: string; code?: string }

// Per instance and short-lived: enough to spare Meta one lookup per clinic in
// a cron run, short enough that an approval is picked up within minutes.
// Lookup errors are never cached, so the next send asks again.
const TTL_MS = 5 * 60 * 1000

const cache = new Map<string, { approval: LifecycleTemplateApproval; expiresAt: number }>()

export async function getLifecycleTemplateApproval(templateName: string): Promise<LifecycleTemplateApproval> {
  const cached = cache.get(templateName)
  if (cached && cached.expiresAt > Date.now()) return cached.approval

  let approval: LifecycleTemplateApproval
  try {
    const template = await findPlatformTemplate(templateName)
    approval =
      template?.status === 'APPROVED'
        ? { state: 'approved' }
        : { state: 'not_approved', status: template?.status ?? 'MISSING' }
  } catch (err) {
    cache.delete(templateName)
    const error = err instanceof Error ? err.message : String(err)
    return err instanceof BusinessError ? { state: 'unknown', error, code: err.code } : { state: 'unknown', error }
  }
  cache.set(templateName, { approval, expiresAt: Date.now() + TTL_MS })
  return approval
}

// Message key -> BR day whose not-approved alert this instance already
// settled (sent it, or saw another instance's earlier skip). Spares the DB
// check on every further skip of the day; the DB check, keyed the same way,
// is the real dedupe.
const alertSettledOn = new Map<string, string>()

export function isTemplateAlertSettled(messageKey: string, brDay: string): boolean {
  return alertSettledOn.get(messageKey) === brDay
}

export function markTemplateAlertSettled(messageKey: string, brDay: string): void {
  alertSettledOn.set(messageKey, brDay)
}

/** Test helper: forget every cached lookup and alert guard. */
export function clearLifecycleTemplateApprovalCache(): void {
  cache.clear()
  alertSettledOn.clear()
}
