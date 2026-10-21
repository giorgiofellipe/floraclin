import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const pathnameMock = vi.hoisted(() => vi.fn(() => '/dashboard'))
vi.mock('next/navigation', () => ({ usePathname: pathnameMock }))

import { ExpiredPaywall, ReadOnlyBadge, paywallStorageKey, shouldAutoOpenPaywall } from '../expired-paywall'
import { ReadOnlyGuard, SubscriptionAccessProvider } from '../subscription-access'
import { brToday } from '@/lib/dates'

const PLANS = [
  { slug: 'starter', name: 'Starter', priceCents: 14900, billingInterval: 'month' },
  { slug: 'pro', name: 'Pro', priceCents: 29900, billingInterval: 'month' },
]

function renderWith(readOnly: boolean, extra: Partial<Parameters<typeof SubscriptionAccessProvider>[0]> = {}) {
  return render(
    <SubscriptionAccessProvider
      readOnly={readOnly}
      reason={readOnly ? 'trial' : null}
      tenantId="t1"
      canSubscribe
      plans={PLANS}
      winback={null}
      {...extra}
    >
      <ReadOnlyBadge />
      <ReadOnlyGuard>
        <button type="button" onClick={() => { throw new Error('must not be reachable') }}>Novo Paciente</button>
      </ReadOnlyGuard>
      <ExpiredPaywall />
    </SubscriptionAccessProvider>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  pathnameMock.mockReturnValue('/dashboard')
})

describe('shouldAutoOpenPaywall', () => {
  it('opens once per day and never on settings (billing / profile)', () => {
    expect(shouldAutoOpenPaywall('/dashboard', null, '2026-10-21')).toBe(true)
    expect(shouldAutoOpenPaywall('/dashboard', '2026-10-20', '2026-10-21')).toBe(true)
    expect(shouldAutoOpenPaywall('/dashboard', '2026-10-21', '2026-10-21')).toBe(false)
    expect(shouldAutoOpenPaywall('/configuracoes', null, '2026-10-21')).toBe(false)
    expect(shouldAutoOpenPaywall('/configuracoes/perfil', null, '2026-10-21')).toBe(false)
  })
})

describe('ExpiredPaywall', () => {
  it('renders nothing and leaves controls alone when the subscription is active', () => {
    renderWith(false)

    expect(screen.queryByTestId('expired-paywall')).not.toBeInTheDocument()
    expect(screen.queryByTestId('read-only-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('read-only-guard')).not.toBeInTheDocument()
  })

  it('opens on first load with plans, and "Continuar em modo leitura" closes it for the rest of the day', async () => {
    renderWith(true)

    expect(await screen.findByTestId('expired-paywall')).toBeInTheDocument()
    expect(screen.getByText('Seu período de teste terminou')).toBeInTheDocument()
    expect(screen.getByTestId('paywall-subscribe-starter')).toHaveTextContent('Assinar Starter')
    expect(screen.getByText(/R\$\s?149,00\/mês/)).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('paywall-read-only'))
    expect(window.localStorage.getItem(paywallStorageKey('t1'))).toBe(brToday())
  })

  it('does not open by itself once dismissed today, but the badge and a guarded button reopen it', async () => {
    window.localStorage.setItem(paywallStorageKey('t1'), brToday())
    renderWith(true)

    expect(screen.queryByTestId('expired-paywall')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('read-only-guard'))
    expect(await screen.findByTestId('expired-paywall')).toBeInTheDocument()
  })

  it('does not open by itself on the billing page', () => {
    pathnameMock.mockReturnValue('/configuracoes')
    renderWith(true)

    expect(screen.queryByTestId('expired-paywall')).not.toBeInTheDocument()
    expect(screen.getByTestId('read-only-badge')).toBeInTheDocument()
  })

  it('shows the win-back offer when the server says the clinic is eligible', async () => {
    renderWith(true, { winback: { label: '30% de desconto nos 3 primeiros meses', endsAt: '2026-11-03T15:00:00.000Z' } })

    expect(await screen.findByTestId('winback-offer')).toHaveTextContent(
      'Oferta para voltar: 30% de desconto nos 3 primeiros meses',
    )
  })

  it('tells a non-owner who can subscribe instead of showing checkout buttons', async () => {
    renderWith(true, { canSubscribe: false })

    await screen.findByTestId('expired-paywall')
    expect(screen.queryByTestId('paywall-subscribe-starter')).not.toBeInTheDocument()
    expect(screen.getByText(/só o responsável pela clínica pode assinar/i)).toBeInTheDocument()
  })
})
