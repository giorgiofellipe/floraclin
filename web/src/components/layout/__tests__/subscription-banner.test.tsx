import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SubscriptionBanner } from '../subscription-banner'

/**
 * `canceled` means two different things to the person reading it, and the
 * banner used to tell them only the first: "você mantém acesso até o fim do
 * período contratado". Nothing moves the status on when that period closes
 * (the expiry cron only looks at trials), so a lapsed customer kept being
 * reassured about access they no longer had, and the "Reativar" link went to
 * a page whose only offer was a different plan from the one they had.
 */

const NOW = new Date('2026-09-01T12:00:00.000Z')
const FUTURE = '2026-09-20T00:00:00.000Z'
const PAST = '2026-08-01T00:00:00.000Z'

// The banner branches on `currentPeriodEnd > new Date()`, so without a frozen
// clock these fixtures quietly stop meaning "future" and "past" and the suite
// goes red on a date nobody chose.
beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterAll(() => {
  vi.useRealTimers()
})

describe('SubscriptionBanner, cancelled', () => {
  it('reassures while the paid period is still open', () => {
    render(<SubscriptionBanner subscriptionStatus="canceled" currentPeriodEnd={FUTURE} />)

    expect(screen.getByText(/mantém acesso até o fim do período/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /reativar/i })).toBeInTheDocument()
  })

  it('says the subscription ended once the period has closed', () => {
    render(<SubscriptionBanner subscriptionStatus="canceled" currentPeriodEnd={PAST} />)

    expect(screen.queryByText(/mantém acesso/i)).not.toBeInTheDocument()
    expect(screen.getByText(/assinatura terminou/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /assinar agora/i })).toBeInTheDocument()
  })

  it('does not promise access it cannot verify', () => {
    // No period end at all: assume the worst rather than reassure.
    render(<SubscriptionBanner subscriptionStatus="canceled" currentPeriodEnd={null} />)

    expect(screen.getByText(/assinatura terminou/i)).toBeInTheDocument()
  })
})

describe('SubscriptionBanner, other states', () => {
  it('shows nothing for an active subscription', () => {
    const { container } = render(
      <SubscriptionBanner subscriptionStatus="active" currentPeriodEnd={FUTURE} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('still calls an expired trial a trial', () => {
    // With cancellations staying on `canceled`, `expired` now only ever
    // means a trial ran out, so this copy is accurate.
    render(<SubscriptionBanner subscriptionStatus="expired" currentPeriodEnd={PAST} />)

    expect(screen.getByText(/período de teste expirou/i)).toBeInTheDocument()
  })

  it('counts down a running trial', () => {
    render(<SubscriptionBanner subscriptionStatus="trialing" currentPeriodEnd={FUTURE} />)

    expect(screen.getByText(/teste gratuito/i)).toBeInTheDocument()
  })
})
