import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const pathnameMock = vi.hoisted(() => vi.fn(() => '/dashboard'))
vi.mock('next/navigation', () => ({
  usePathname: pathnameMock,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, onClick, ...rest }: { href: string; children: React.ReactNode; onClick?: () => void }) => (
    <a href={href} onClick={(e) => { e.preventDefault(); onClick?.() }} {...rest}>{children}</a>
  ),
}))

import { ExpiredPaywall, ReadOnlyBadge, paywallStorageKey, shouldAutoOpenPaywall } from '../expired-paywall'
import { ReadOnlyGuard, SubscriptionAccessProvider } from '../subscription-access'

// 09:00 BRT. Frozen so "today" in the stored dismissal and in the component
// can never straddle midnight mid-test.
const NOW = new Date('2026-10-21T12:00:00.000Z')
const TODAY = '2026-10-21'

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
      <ReadOnlyGuard label="Novo Paciente">
        <button type="button">Novo Paciente</button>
      </ReadOnlyGuard>
      <ExpiredPaywall />
    </SubscriptionAccessProvider>,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  window.localStorage.clear()
  pathnameMock.mockReturnValue('/dashboard')
})
afterEach(() => {
  vi.useRealTimers()
})

describe('shouldAutoOpenPaywall', () => {
  it('opens once per day and never on settings (billing / profile)', () => {
    expect(shouldAutoOpenPaywall('/dashboard', null, TODAY)).toBe(true)
    expect(shouldAutoOpenPaywall('/dashboard', '2026-10-20', TODAY)).toBe(true)
    expect(shouldAutoOpenPaywall('/dashboard', TODAY, TODAY)).toBe(false)
    expect(shouldAutoOpenPaywall('/configuracoes', null, TODAY)).toBe(false)
    expect(shouldAutoOpenPaywall('/configuracoes/perfil', null, TODAY)).toBe(false)
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
    await waitFor(() => expect(screen.queryByTestId('expired-paywall')).not.toBeInTheDocument())
    expect(window.localStorage.getItem(paywallStorageKey('t1'))).toBe(TODAY)
  })

  it('does not open by itself once dismissed today; a guarded button reopens it', async () => {
    window.localStorage.setItem(paywallStorageKey('t1'), TODAY)
    renderWith(true)

    expect(screen.queryByTestId('expired-paywall')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('read-only-guard'))
    expect(await screen.findByTestId('expired-paywall')).toBeInTheDocument()
  })

  it('the "Modo leitura" badge reopens it', async () => {
    window.localStorage.setItem(paywallStorageKey('t1'), TODAY)
    renderWith(true)

    fireEvent.click(screen.getByTestId('read-only-badge'))
    expect(await screen.findByTestId('expired-paywall')).toBeInTheDocument()
  })

  it('keeps the control name for assistive tech and marks it unavailable', () => {
    window.localStorage.setItem(paywallStorageKey('t1'), TODAY)
    renderWith(true)

    // jsdom does not implement `inert`, so query the wrapper directly; in a
    // browser it is the only element exposed.
    const guard = screen.getByTestId('read-only-guard')
    expect(guard).toHaveAccessibleName('Novo Paciente')
    expect(guard).toHaveAttribute('aria-disabled', 'true')
    expect(guard).toHaveAccessibleDescription(/modo leitura/i)
  })

  it('does not open by itself on the billing page, but does on the next page of the session', async () => {
    pathnameMock.mockReturnValue('/configuracoes')
    const { rerender } = renderWith(true)
    expect(screen.queryByTestId('expired-paywall')).not.toBeInTheDocument()

    pathnameMock.mockReturnValue('/agenda')
    rerender(
      <SubscriptionAccessProvider readOnly reason="trial" tenantId="t1" canSubscribe plans={PLANS} winback={null}>
        <ExpiredPaywall />
      </SubscriptionAccessProvider>,
    )
    expect(await screen.findByTestId('expired-paywall')).toBeInTheDocument()
  })

  it('picking an export from the paywall gets the paywall out of the way', async () => {
    renderWith(true)
    await screen.findByTestId('expired-paywall')

    fireEvent.click(screen.getByTestId('export-data-link'))
    fireEvent.click(await screen.findByText('Prontuário do paciente (PDF)'))

    await waitFor(() => expect(screen.queryByTestId('expired-paywall')).not.toBeInTheDocument())
  })

  it('shows the win-back offer when the server says the clinic is eligible', async () => {
    renderWith(true, { winback: { label: '30% de desconto nos 3 primeiros meses', endsAt: '2026-11-03T15:00:00.000Z' } })

    expect(await screen.findByTestId('winback-offer')).toHaveTextContent(
      'Oferta para voltar: 30% de desconto nos 3 primeiros meses. Aplicada automaticamente no pagamento até 03/11',
    )
  })

  it('tells a non-owner who can subscribe instead of showing checkout buttons', async () => {
    renderWith(true, { canSubscribe: false })

    await screen.findByTestId('expired-paywall')
    expect(screen.queryByTestId('paywall-subscribe-starter')).not.toBeInTheDocument()
    expect(screen.getByText(/só a pessoa responsável pela clínica pode assinar/i)).toBeInTheDocument()
  })
})
