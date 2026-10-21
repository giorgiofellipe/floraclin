import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SubscriptionBanner } from '../subscription-banner'

/**
 * `canceled` means two different things to the person reading it, and the
 * banner used to tell them only the first: "você mantém acesso até o fim do
 * período contratado". Nothing moves the status on when that period closes
 * (the expiry cron never moves `canceled`), so a lapsed customer kept being
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

describe('SubscriptionBanner, trial countdown escalation', () => {
  const inDays = (days: number, hours = 0) =>
    new Date(NOW.getTime() + (days * 24 + hours) * 60 * 60 * 1000).toISOString()

  it('stays green and dismissible with more than 3 days left', () => {
    render(<SubscriptionBanner subscriptionStatus="trialing" currentPeriodEnd={inDays(6)} />)

    expect(screen.getByText(/6 dias restantes/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /fechar/i })).toBeInTheDocument()
  })

  it.each([3, 2, 1])('turns amber and cannot be dismissed with %s day(s) left', (days) => {
    render(<SubscriptionBanner subscriptionStatus="trialing" currentPeriodEnd={inDays(days)} />)

    expect(screen.getByTestId('trial-banner-ending')).toHaveTextContent(
      `termina em ${days} ${days === 1 ? 'dia' : 'dias'}`,
    )
    expect(screen.queryByRole('button', { name: /fechar/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /assinar agora/i })).toBeInTheDocument()
  })

  it('says "termina hoje" in red on the last day, never "0 dias restantes"', () => {
    // NOW is 09:00 BRT; this ends at 18:00 BRT the same day.
    render(<SubscriptionBanner subscriptionStatus="trialing" currentPeriodEnd={inDays(0, 9)} />)

    const banner = screen.getByTestId('trial-banner-last-day')
    expect(banner).toHaveTextContent(/termina hoje, às 18:00/i)
    expect(banner).not.toHaveTextContent(/0 dias/i)
    expect(screen.queryByRole('button', { name: /fechar/i })).not.toBeInTheDocument()
  })

  it('calls a lapsed gift a subscription that ended, not a trial', () => {
    render(<SubscriptionBanner subscriptionStatus="expired" currentPeriodEnd={PAST} subscriptionSource="gift" />)

    expect(screen.getByText(/sua assinatura terminou/i)).toBeInTheDocument()
    expect(screen.queryByText(/período de teste/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /exportar meus dados/i })).toBeInTheDocument()
  })
})
