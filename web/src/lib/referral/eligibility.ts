import { subMonths } from 'date-fns'
import { REFERRAL_NEW_CLINIC_WINDOW_MONTHS } from './rules'
import type { CandidateTenant, CheckResult, NotNewSignalKind, SignalKind, TenantSignals } from './types'

/** Webmail domains: a shared domain here is never evidence. */
export const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com', 'outlook.com.br',
  'live.com', 'msn.com', 'yahoo.com', 'yahoo.com.br', 'icloud.com', 'me.com', 'uol.com.br',
  'bol.com.br', 'terra.com.br', 'ig.com.br', 'globo.com', 'globomail.com', 'protonmail.com',
  'proton.me', 'zoho.com', 'aol.com',
])

type Match = { tenantId: string; signals: SignalKind[] }
type Verdict = 'self_referral' | 'not_new' | null

const ALL_NOT_NEW_KINDS: NotNewSignalKind[] = ['owner_email', 'phone', 'registry', 'card']

export function emailDomain(email: string): string | null {
  const at = email.trim().toLowerCase().lastIndexOf('@')
  if (at < 0) return null
  const domain = email.trim().toLowerCase().slice(at + 1)
  return domain.length > 0 ? domain : null
}

function intersects(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a.filter((v) => v !== ''))
  return b.some((v) => v !== '' && set.has(v))
}

function customDomains(emails: readonly string[]): string[] {
  const out: string[] = []
  for (const email of emails) {
    const domain = emailDomain(email)
    if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) out.push(domain)
  }
  return out
}

function sortedKinds(kinds: Iterable<SignalKind>): SignalKind[] {
  return [...new Set(kinds)].sort()
}

/** Signals shared by the referred clinic and its referrer (all six kinds). Sorted, unique. */
export function selfReferralMatches(referred: TenantSignals, referrer: TenantSignals): SignalKind[] {
  const found: SignalKind[] = []
  if (intersects(referred.ownerEmails, referrer.ownerEmails)) found.push('owner_email')
  if (intersects(customDomains(referred.ownerEmails), customDomains(referrer.ownerEmails))) found.push('email_domain')
  if (intersects(referred.phones, referrer.phones)) found.push('phone')
  if (intersects(referred.registries, referrer.registries)) found.push('registry')
  if (intersects(referred.userIds, referrer.userIds)) found.push('shared_user')
  if (intersects(referred.cardFingerprints, referrer.cardFingerprints)) found.push('card')
  return sortedKinds(found)
}

/**
 * Other tenants that make the referred clinic not new. The referrer and the
 * referred tenant themselves are excluded by the caller and again here.
 */
export function notNewMatches(
  referred: TenantSignals,
  candidates: CandidateTenant[],
  referredSignupAt: Date,
  excludeTenantIds: string[],
  kinds: NotNewSignalKind[] = ALL_NOT_NEW_KINDS,
): Match[] {
  const excluded = new Set([...excludeTenantIds, referred.tenantId])
  const windowStart = subMonths(referredSignupAt, REFERRAL_NEW_CLINIC_WINDOW_MONTHS).getTime()
  const signupMs = referredSignupAt.getTime()
  const want = new Set(kinds)
  const out: Match[] = []

  for (const c of candidates) {
    if (excluded.has(c.tenantId)) continue
    const found: SignalKind[] = []

    const rowInWindow = c.subscriptionCreatedAt.getTime() <= signupMs && c.subscriptionEndsAt.getTime() >= windowStart
    if (rowInWindow) {
      if (want.has('owner_email') && intersects(referred.ownerEmails, c.ownerEmails)) found.push('owner_email')
      if (want.has('phone') && intersects(referred.phones, c.phones)) found.push('phone')
      if (want.has('registry') && intersects(referred.registries, c.registries)) found.push('registry')
    }

    if (want.has('card')) {
      const mine = new Set(referred.cardFingerprints.filter((f) => f !== ''))
      const hit = c.cards.some(
        (s) => mine.has(s.fingerprint) && s.firstSeenAt.getTime() <= signupMs && s.lastSeenAt.getTime() >= windowStart,
      )
      if (hit) found.push('card')
    }

    if (found.length > 0) out.push({ tenantId: c.tenantId, signals: sortedKinds(found) })
  }
  return out.sort((a, b) => (a.tenantId < b.tenantId ? -1 : a.tenantId > b.tenantId ? 1 : 0))
}

/** Verdict: self_referral beats not_new; null = eligible. */
export function eligibilityVerdict(self: SignalKind[], notNew: Match[]): Verdict {
  if (self.length > 0) return 'self_referral'
  if (notNew.length > 0) return 'not_new'
  return null
}

/**
 * The one place that runs the checks, so its callers can't diverge.
 * Loaders are injected so this file has no DB imports.
 */
export async function runEligibilityChecks(
  input: {
    referredTenantId: string
    referrerTenantId: string
    referredSignupAt: Date
    stage: 'attribution' | 'checkout' | 'qualification'
  },
  loaders: {
    loadSignals(tenantId: string): Promise<TenantSignals>
    loadCandidates(referred: TenantSignals, exclude: string[]): Promise<CandidateTenant[]>
  },
): Promise<CheckResult & { verdict: Verdict }> {
  const exclude = [input.referrerTenantId, input.referredTenantId]
  const [referred, referrer] = await Promise.all([
    loaders.loadSignals(input.referredTenantId),
    loaders.loadSignals(input.referrerTenantId),
  ])

  const qualification = input.stage === 'qualification'
  const selfAll = selfReferralMatches(referred, referrer)
  const selfReferral = qualification ? selfAll : selfAll.filter((k) => k !== 'card')

  let kinds: NotNewSignalKind[]
  if (qualification) kinds = ['card']
  else kinds = referred.cardFingerprints.length > 0 ? ['owner_email', 'phone', 'registry', 'card'] : ['owner_email', 'phone', 'registry']

  const candidates = await loaders.loadCandidates(referred, exclude)
  const notNew = notNewMatches(referred, candidates, input.referredSignupAt, exclude, kinds)

  return { selfReferral, notNew, verdict: eligibilityVerdict(selfReferral, notNew) }
}
