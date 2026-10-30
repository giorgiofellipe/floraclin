'use client'

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { TrialRecap } from '@/lib/trial-recap'
import type { PublicWinbackOffer } from '@/lib/winback'
import type { PublicReferralOffer } from '@/lib/referral/offer-copy'
import type { PublicFeedbackOffer } from '@/lib/feedback-offer-copy'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const LOCK_REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000

export const READ_ONLY_TOOLTIP = 'Modo leitura: assine um plano para criar ou editar.'

export interface PaywallPlan {
  slug: string
  name: string
  priceCents: number
  billingInterval: string
  /** 3-4 short pt-BR lines from the plan's limits / features. */
  benefits: string[]
  /** The plan the paywall highlights. */
  recommended: boolean
}

export interface SubscriptionAccess {
  /** True when the clinic's subscription is inactive. The server enforces the
   *  same rule (402 from `requireWrite`); this only lets the UI say so first. */
  readOnly: boolean
  /** Why it is read-only: a trial that ran out, or a subscription that ended. */
  reason: 'trial' | 'subscription' | null
  tenantId: string
  canSubscribe: boolean
  plans: PaywallPlan[]
  /** The feedback reward offer; when set, `winback` and `referral` are not. */
  feedback: PublicFeedbackOffer | null
  winback: PublicWinbackOffer | null
  /** The referral welcome offer; never set together with `winback`. */
  referral: PublicReferralOffer | null
  /** The viewer's role in this clinic; decides which exports they can open. */
  role: string
  /** How the clinic gets access back: a new plan (checkout), or fixing the
   *  card of a Stripe subscription whose payment failed (billing portal). */
  recovery: 'checkout' | 'payment_update'
  /** What the clinic set up during the trial, when the paywall or the
   *  trial-ending modal can show it. */
  recap: TrialRecap | null
  /** End of a running free trial with at most one BR day left (ISO), for the
   *  one-time "seu teste termina amanhã" modal. */
  trialEndsAt: string | null
  paywallOpen: boolean
  openPaywall: () => void
  closePaywall: () => void
}

const SubscriptionAccessContext = createContext<SubscriptionAccess | null>(null)

const NOT_READ_ONLY: SubscriptionAccess = {
  readOnly: false,
  reason: null,
  tenantId: '',
  canSubscribe: false,
  plans: [],
  feedback: null,
  winback: null,
  referral: null,
  role: '',
  recovery: 'checkout',
  recap: null,
  trialEndsAt: null,
  paywallOpen: false,
  openPaywall: () => {},
  closePaywall: () => {},
}

export function SubscriptionAccessProvider({
  children,
  readOnly,
  reason,
  tenantId,
  canSubscribe,
  plans,
  feedback = null,
  winback,
  referral = null,
  lockAt = null,
  role = '',
  recovery = 'checkout',
  recap = null,
  trialEndsAt = null,
}: {
  role?: string
  recovery?: 'checkout' | 'payment_update'
  recap?: TrialRecap | null
  trialEndsAt?: string | null
  children: ReactNode
  /** When a running trial / grant ends (ISO), so an open tab re-renders the
   *  layout into read-only mode at that instant instead of only failing
   *  saves with 402 until the next full load. */
  lockAt?: string | null
  readOnly: boolean
  reason: 'trial' | 'subscription' | null
  tenantId: string
  canSubscribe: boolean
  plans: PaywallPlan[]
  feedback?: PublicFeedbackOffer | null
  winback: PublicWinbackOffer | null
  referral?: PublicReferralOffer | null
}) {
  const [paywallOpen, setPaywallOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (readOnly || !lockAt) return
    const ms = new Date(lockAt).getTime() - Date.now()
    // Only within a day: longer timers are pointless for a tab and
    // setTimeout overflows past ~24.8 days anyway.
    if (!(ms >= 0 && ms <= LOCK_REFRESH_WINDOW_MS)) return
    const id = window.setTimeout(() => router.refresh(), ms + 1000)
    return () => window.clearTimeout(id)
  }, [readOnly, lockAt, router])
  const openPaywall = useCallback(() => setPaywallOpen(true), [])
  const closePaywall = useCallback(() => setPaywallOpen(false), [])

  // Global safety net: any write the UI did not guard comes back from
  // `requireWrite` as 402 `subscription_expired`. Open the paywall for it
  // (and switch an open tab into read-only mode) instead of leaving the
  // caller's error toast as the only explanation.
  // Installed once; the latest state is read through a ref so a re-render
  // never stacks a second wrapper. A burst of parallel 402s refreshes once.
  const expiredStateRef = useRef({ readOnly, router, refreshing: false })
  useEffect(() => {
    expiredStateRef.current.readOnly = readOnly
    expiredStateRef.current.router = router
    if (readOnly) expiredStateRef.current.refreshing = false
  }, [readOnly, router])
  useEffect(() => {
    return installSubscriptionExpiredInterceptor(() => {
      setPaywallOpen(true)
      const state = expiredStateRef.current
      if (state.readOnly || state.refreshing) return
      state.refreshing = true
      state.router.refresh()
    })
  }, [])

  const value = useMemo<SubscriptionAccess>(
    () => ({
      readOnly,
      reason,
      tenantId,
      canSubscribe,
      plans,
      feedback,
      winback,
      referral,
      role,
      recovery,
      recap,
      trialEndsAt,
      paywallOpen,
      openPaywall,
      closePaywall,
    }),
    [readOnly, reason, tenantId, canSubscribe, plans, feedback, winback, referral, role, recovery, recap, trialEndsAt, paywallOpen, openPaywall, closePaywall],
  )

  return <SubscriptionAccessContext.Provider value={value}>{children}</SubscriptionAccessContext.Provider>
}

/** Outside the platform layout (tests, public pages) nothing is read-only. */
export function useSubscriptionAccess(): SubscriptionAccess {
  return useContext(SubscriptionAccessContext) ?? NOT_READ_ONLY
}

export function useReadOnly(): boolean {
  return useSubscriptionAccess().readOnly
}

/**
 * Wraps a handler that would start a create / edit / delete. In read-only
 * mode the wrapped handler opens the paywall instead; otherwise it runs the
 * original. For controls where dimming the trigger would hide something the
 * user still needs to read (a row menu, an appointment card).
 */
export function useWriteGuard(): <A extends unknown[]>(action: (...args: A) => void) => (...args: A) => void {
  const { readOnly, openPaywall } = useSubscriptionAccess()
  return useCallback(
    <A extends unknown[]>(action: (...args: A) => void) =>
      (...args: A) => {
        if (readOnly) {
          openPaywall()
          return
        }
        action(...args)
      },
    [readOnly, openPaywall],
  )
}

const SUBSCRIPTION_EXPIRED_CODE = 'subscription_expired'

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/** Judged on the request, not the response: a synthetic or opaque Response
 *  has no url, and a relative request path is always ours. */
function isSameOrigin(input: RequestInfo | URL): boolean {
  try {
    return new URL(requestUrl(input), window.location.href).origin === window.location.origin
  } catch {
    return false
  }
}

/**
 * Wraps `window.fetch` so a same-origin 402 with code `subscription_expired`
 * calls `onExpired`. The response is handed back untouched (the body is read
 * from a clone), so callers keep their own error handling. Returns the
 * uninstall function. Other 402s (WhatsApp credits) are left alone.
 */
export function installSubscriptionExpiredInterceptor(onExpired: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const original = window.fetch
  const wrapped: typeof window.fetch = async (input, init) => {
    const response = await original(input, init)
    if (response.status === 402 && isSameOrigin(input)) {
      response
        .clone()
        .json()
        .then((body: unknown) => {
          if ((body as { code?: unknown } | null)?.code === SUBSCRIPTION_EXPIRED_CODE) onExpired()
        })
        .catch(() => {})
    }
    return response
  }
  window.fetch = wrapped
  return () => {
    // Only unwind our own layer; something installed later stays.
    if (window.fetch === wrapped) window.fetch = original
  }
}

/**
 * Wraps a create/edit control. In read-only mode the control is rendered
 * inert and dimmed, with a tooltip saying why, and a click opens the paywall
 * instead of failing later with a 402. Outside read-only mode it renders the
 * child untouched.
 *
 * Works for buttons and links alike: `inert` removes the child from focus and
 * pointer handling, so the wrapper is the only thing the user can reach.
 */
export function ReadOnlyGuard({
  children,
  label,
  className,
}: {
  children: ReactNode
  /** The control's own name, e.g. "Novo Paciente". `inert` hides the child
   *  from assistive tech too, so the wrapper has to carry it. */
  label: string
  className?: string
}) {
  const { readOnly, openPaywall } = useSubscriptionAccess()
  const descriptionId = useId()
  if (!readOnly) return <>{children}</>

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              role="button"
              tabIndex={0}
              aria-disabled="true"
              // The control keeps its own name ("Novo Paciente"); the reason
              // it is unavailable is the description.
              aria-label={label}
              aria-describedby={descriptionId}
              data-testid="read-only-guard"
              className={cn('inline-flex cursor-not-allowed', className)}
              onClick={openPaywall}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  openPaywall()
                }
              }}
            />
          }
        >
          <span inert className="pointer-events-none inline-flex opacity-50">
            {children}
          </span>
          <span id={descriptionId} className="sr-only">
            {READ_ONLY_TOOLTIP}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{READ_ONLY_TOOLTIP}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
