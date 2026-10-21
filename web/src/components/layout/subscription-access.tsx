'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export const READ_ONLY_TOOLTIP = 'Modo leitura: assine um plano para criar ou editar.'

export interface PaywallPlan {
  slug: string
  name: string
  priceCents: number
  billingInterval: string
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
  winback: { label: string; endsAt: string } | null
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
  winback: null,
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
  winback,
}: {
  children: ReactNode
  readOnly: boolean
  reason: 'trial' | 'subscription' | null
  tenantId: string
  canSubscribe: boolean
  plans: PaywallPlan[]
  winback: { label: string; endsAt: string } | null
}) {
  const [paywallOpen, setPaywallOpen] = useState(false)
  const openPaywall = useCallback(() => setPaywallOpen(true), [])
  const closePaywall = useCallback(() => setPaywallOpen(false), [])

  const value = useMemo<SubscriptionAccess>(
    () => ({ readOnly, reason, tenantId, canSubscribe, plans, winback, paywallOpen, openPaywall, closePaywall }),
    [readOnly, reason, tenantId, canSubscribe, plans, winback, paywallOpen, openPaywall, closePaywall],
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
 * Wraps a create/edit control. In read-only mode the control is rendered
 * inert and dimmed, with a tooltip saying why, and a click opens the paywall
 * instead of failing later with a 402. Outside read-only mode it renders the
 * child untouched.
 *
 * Works for buttons and links alike: `inert` removes the child from focus and
 * pointer handling, so the wrapper is the only thing the user can reach.
 */
export function ReadOnlyGuard({ children, className }: { children: ReactNode; className?: string }) {
  const { readOnly, openPaywall } = useSubscriptionAccess()
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
              aria-label={READ_ONLY_TOOLTIP}
              data-testid="read-only-guard"
              className={['inline-flex cursor-not-allowed', className].filter(Boolean).join(' ')}
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
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{READ_ONLY_TOOLTIP}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
