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

// A failing test must not leak its fetch stub into the next one.
afterEach(() => {
  vi.unstubAllGlobals()
})

// 09:00 BRT. Frozen so "today" in the stored dismissal and in the component
// can never straddle midnight mid-test.
const NOW = new Date('2026-10-21T12:00:00.000Z')
const TODAY = '2026-10-21'

const OFFER = {
  label: '30% de desconto nos 3 primeiros meses',
  endsAt: '2026-11-04T02:59:59.999Z',
  percentOff: 30,
  amountOffCents: null,
  duration: 'repeating' as const,
  durationInMonths: 3,
  planSlugs: ['starter', 'pro'],
}

const REFERRAL = {
  kind: 'referral' as const,
  referrerName: 'Clínica Bela',
  label: '20% de desconto nos 2 primeiros meses',
  percentOff: 20,
  amountOffCents: null,
  duration: 'repeating' as const,
  durationInMonths: 2,
  planSlugs: ['starter', 'pro'],
}

const FEEDBACK = {
  kind: 'feedback' as const,
  label: '50% de desconto nos 3 primeiros meses',
  percentOff: 50,
  amountOffCents: null,
  duration: 'repeating' as const,
  durationInMonths: 3,
  planSlugs: ['starter', 'pro'],
}

const PLANS = [
  {
    slug: 'starter',
    name: 'Starter',
    priceCents: 9900,
    billingInterval: 'month',
    benefits: ['Agenda, prontuário e diagrama facial', 'Até 2 usuários'],
    recommended: false,
  },
  {
    slug: 'pro',
    name: 'Pro',
    priceCents: 19900,
    billingInterval: 'month',
    benefits: ['Agenda, prontuário e diagrama facial', 'Usuários ilimitados para a equipe'],
    recommended: true,
  },
]
const RECAP = { patients: 12, appointments: 30, procedureRecords: 4, photos: 0, diagrams: 2 }

function renderWith(readOnly: boolean, extra: Partial<Parameters<typeof SubscriptionAccessProvider>[0]> = {}) {
  return render(
    <SubscriptionAccessProvider
      readOnly={readOnly}
      reason={readOnly ? 'trial' : null}
      tenantId="t1"
      canSubscribe
      plans={PLANS}
      winback={null}
      role="owner"
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
    expect(screen.getByTestId('paywall-eyebrow')).toHaveTextContent('Seu teste gratuito terminou')
    expect(screen.getByTestId('paywall-subscribe-starter')).toHaveTextContent('Continuar com o Starter')
    expect(screen.getByTestId('paywall-plan-starter')).toHaveTextContent(/R\$\s?99,00\/mês/)
    expect(screen.getByTestId('paywall-trust')).toHaveTextContent('Cancele quando quiser')

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
      <SubscriptionAccessProvider readOnly reason="trial" tenantId="t1" canSubscribe plans={PLANS} winback={null} role="owner">
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

  it('shows the win-back offer with the discounted price struck against the full one', async () => {
    renderWith(true, { winback: OFFER })

    expect(await screen.findByTestId('winback-offer')).toHaveTextContent(
      'Oferta para voltar: 30% de desconto nos 3 primeiros meses. Aplicada automaticamente no pagamento até 03/11',
    )
    const pro = screen.getByTestId('paywall-plan-pro')
    expect(pro).toHaveTextContent(/R\$\s?139,30/)
    expect(pro.querySelector('s')).toHaveTextContent(/R\$\s?199,00/)
    // The price after the discount, said plainly: no surprise on month 4.
    expect(screen.getByTestId('paywall-plan-pro-terms')).toHaveTextContent(/Nos 3 primeiros meses, depois R\$\s?199,00\/mês/)
    // The entry price near the headline is the lowest price under the offer.
    expect(screen.getByTestId('paywall-entry-price')).toHaveTextContent(/Planos a partir de R\$\s?69,30\/mês com a oferta/)
  })

  it('shows the referral offer with the discounted price struck against the full one', async () => {
    renderWith(true, { referral: REFERRAL })

    expect(await screen.findByTestId('referral-offer')).toHaveTextContent(
      'Indicação de Clínica Bela: 20% de desconto nos 2 primeiros meses. Aplicado automaticamente no pagamento.',
    )
    const starter = screen.getByTestId('paywall-plan-starter')
    expect(starter).toHaveTextContent(/R\$\s?79,20/)
    expect(starter.querySelector('s')).toHaveTextContent(/R\$\s?99,00/)
    expect(screen.getByTestId('paywall-entry-price')).toHaveTextContent(/Planos a partir de R\$\s?79,20\/mês com a oferta/)
  })

  it('never shows the referral badge next to a win-back offer', async () => {
    renderWith(true, { winback: OFFER, referral: REFERRAL })

    expect(await screen.findByTestId('winback-offer')).toBeInTheDocument()
    expect(screen.queryByTestId('referral-offer')).not.toBeInTheDocument()
    // Prices follow the win-back (30%), not the referral (20%).
    expect(screen.getByTestId('paywall-plan-starter')).toHaveTextContent(/R\$\s?69,30/)
  })

  it('shows the feedback offer with the discounted price struck against the full one', async () => {
    renderWith(true, { feedback: FEEDBACK })

    expect(await screen.findByTestId('feedback-offer')).toHaveTextContent(
      'Obrigado pelo feedback: 50% de desconto nos 3 primeiros meses. Aplicado automaticamente no pagamento.',
    )
    const pro = screen.getByTestId('paywall-plan-pro')
    expect(pro).toHaveTextContent(/R\$\s?99,50/)
    expect(pro.querySelector('s')).toHaveTextContent(/R\$\s?199,00/)
    expect(screen.getByTestId('paywall-plan-pro-terms')).toHaveTextContent(/Nos 3 primeiros meses, depois R\$\s?199,00\/mês/)
    expect(screen.getByTestId('paywall-entry-price')).toHaveTextContent(/Planos a partir de R\$\s?49,50\/mês com a oferta/)
  })

  it('shows only the feedback offer, and its prices, when the others are also set (checkout applies it first)', async () => {
    renderWith(true, { feedback: FEEDBACK, winback: OFFER, referral: REFERRAL })

    expect(await screen.findByTestId('feedback-offer')).toBeInTheDocument()
    expect(screen.queryByTestId('winback-offer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('referral-offer')).not.toBeInTheDocument()
    // 50% off R$ 99, not the win-back's 30%.
    expect(screen.getByTestId('paywall-plan-starter')).toHaveTextContent(/R\$\s?49,50/)
  })

  it('shows no feedback badge and full prices without the offer', async () => {
    renderWith(true)

    await screen.findByTestId('expired-paywall')
    expect(screen.queryByTestId('feedback-offer')).not.toBeInTheDocument()
    expect(screen.getByTestId('paywall-plan-pro').querySelector('s')).toBeNull()
  })

  it('discounts only the plans the coupon covers', async () => {
    renderWith(true, { winback: { ...OFFER, label: '30% de desconto nos 3 primeiros meses no plano Pro', planSlugs: ['pro'] } })

    await screen.findByTestId('expired-paywall')
    expect(screen.getByTestId('paywall-plan-pro').querySelector('s')).not.toBeNull()
    const starter = screen.getByTestId('paywall-plan-starter')
    expect(starter.querySelector('s')).toBeNull()
    expect(starter).toHaveTextContent(/R\$\s?99,00/)
    expect(screen.queryByTestId('paywall-plan-starter-terms')).not.toBeInTheDocument()
    // R$ 99 full price is still the cheapest way in.
    expect(screen.getByTestId('paywall-entry-price')).toHaveTextContent(/^Planos a partir de R\$\s?99\/mês$/)
  })

  it('puts Starter first, then the highlighted Pro, with the entry price by the headline', async () => {
    renderWith(true)

    await screen.findByTestId('expired-paywall')
    const cards = screen.getAllByTestId(/^paywall-plan-(starter|pro)$/)
    expect(cards.map((c) => c.dataset.testid)).toEqual(['paywall-plan-starter', 'paywall-plan-pro'])
    expect(screen.getByTestId('paywall-entry-price')).toHaveTextContent(/^Planos a partir de R\$\s?99\/mês$/)
  })

  it('leads with the clinic\'s own numbers and recommends one plan', async () => {
    renderWith(true, { recap: RECAP })

    await screen.findByTestId('expired-paywall')
    expect(screen.getByRole('heading', { name: /sua clínica já está montada/i })).toBeInTheDocument()
    expect(screen.getByTestId('trial-recap')).toHaveTextContent(/12\s*pacientes/)
    expect(screen.getByTestId('trial-recap')).toHaveTextContent(/2\s*diagramas faciais/)
    expect(screen.getByTestId('paywall-plan-pro')).toHaveTextContent('Recomendado')
    expect(screen.getByTestId('paywall-plan-starter')).not.toHaveTextContent('Recomendado')
  })

  it('sends a past_due subscription to the card form, not to a new checkout', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: null }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    renderWith(true, { recovery: 'payment_update', reason: 'subscription' })

    await screen.findByTestId('expired-paywall')
    expect(screen.queryByTestId('paywall-subscribe-pro')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('paywall-update-payment'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/billing/portal')
    expect(JSON.parse(String(init.body))).toEqual({ flow: 'payment_method_update' })
  })

  it('tells a non-owner who can subscribe instead of showing checkout buttons', async () => {
    renderWith(true, { canSubscribe: false })

    await screen.findByTestId('expired-paywall')
    expect(screen.queryByTestId('paywall-subscribe-starter')).not.toBeInTheDocument()
    expect(screen.getByText(/só a pessoa responsável pela clínica pode assinar/i)).toBeInTheDocument()
  })
})

describe('ExportDataDialog roles', () => {
  it.each([
    ['owner', ['Prontuário do paciente (PDF)', 'Relatórios (CSV e PDF)', 'Extrato financeiro (CSV)']],
    ['receptionist', ['Extrato financeiro (CSV)']],
    ['practitioner', []],
  ])('lists only what a %s can open', async (role, expected) => {
    renderWith(true, { role })
    await screen.findByTestId('expired-paywall')
    fireEvent.click(screen.getByTestId('export-data-link'))
    const dialog = await screen.findByTestId('export-data-dialog')
    for (const title of ['Prontuário do paciente (PDF)', 'Relatórios (CSV e PDF)', 'Extrato financeiro (CSV)']) {
      if (expected.includes(title)) expect(dialog).toHaveTextContent(title)
      else expect(dialog).not.toHaveTextContent(title)
    }
    if (expected.length === 0) expect(screen.getByTestId('export-data-no-access')).toBeInTheDocument()
  })
})

describe('global 402 handler', () => {
  it('opens the paywall when any write comes back 402 subscription_expired', async () => {
    window.localStorage.setItem(paywallStorageKey('t1'), TODAY)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'Assinatura expirada.', code: 'subscription_expired' }), { status: 402 }),
      ),
    )
    renderWith(true)
    expect(screen.queryByTestId('expired-paywall')).not.toBeInTheDocument()

    const res = await window.fetch('/api/patients', { method: 'POST' })

    // The caller still gets the response untouched.
    expect(res.status).toBe(402)
    expect(await screen.findByTestId('expired-paywall')).toBeInTheDocument()
  })

  it('ignores a 402 from another origin', async () => {
    window.localStorage.setItem(paywallStorageKey('t1'), TODAY)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ code: 'subscription_expired' }), { status: 402 }),
      ),
    )
    renderWith(true)

    await window.fetch('https://api.example.com/v1/things', { method: 'POST' })
    await new Promise((r) => setTimeout(r, 0))

    expect(screen.queryByTestId('expired-paywall')).not.toBeInTheDocument()
  })

  it('leaves other 402s (WhatsApp credits) alone', async () => {
    window.localStorage.setItem(paywallStorageKey('t1'), TODAY)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Créditos' }), { status: 402 })))
    renderWith(true)

    await window.fetch('/api/whatsapp/send', { method: 'POST' })
    await new Promise((r) => setTimeout(r, 0))

    expect(screen.queryByTestId('expired-paywall')).not.toBeInTheDocument()
  })
})
