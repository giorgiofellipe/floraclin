/**
 * Stripe sends the customer back to success_url as soon as the card clears;
 * the webhook can arrive later. Meanwhile subscriptionStatus lives in the
 * JWT and only refreshes on sign-in or an explicit session.update(). These
 * tests guard the fix: mounting with a session_id posts it to
 * /api/billing/confirm, refreshes the session only after that resolves, and
 * always cleans the id out of the URL so a refresh cannot re-post it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, act, fireEvent } from '@testing-library/react'
import { toast } from 'sonner'
import { renderWithProviders as render } from '@/tests/test-utils'
import { BillingSettings } from '../billing-settings'

// ─── Mocks ─────────────────────────────────────────────────────────

const mockUpdate = vi.fn()
const mockReplace = vi.fn()
let searchParamsValue = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  usePathname: () => '/configuracoes',
  useSearchParams: () => searchParamsValue,
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'authenticated', update: mockUpdate }),
}))

// ─── Fixtures ──────────────────────────────────────────────────────

const USAGE_RESPONSE = {
  subscription: {
    status: 'active',
    // Far future on purpose: this fixture is shared, and a real date here
    // would silently become "past" and change what the component renders.
    currentPeriodEnd: '2999-01-01T00:00:00.000Z',
    stripeSubscriptionId: 'sub_123',
    hasStripeCustomer: true,
    source: 'stripe',
  },
  plan: { name: 'Pro', slug: 'pro', priceCents: 9900, features: {} },
  usage: {
    users: { used: 1, limit: 5 },
    patients: { used: 1, limit: 100 },
    whatsapp: { used: 1, limit: 200 },
  },
}

const PLANS_RESPONSE = { data: [] }

function mockFetch(handlers: Record<string, unknown>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const key = init?.method ? `${init.method} ${url}` : url
    const body = handlers[key]
    if (body === undefined) throw new Error(`unexpected fetch: ${key}`)
    return { ok: true, json: async () => body } as Response
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdate.mockResolvedValue(undefined)
  searchParamsValue = new URLSearchParams()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─── Tests ─────────────────────────────────────────────────────────

describe('BillingSettings payment race', () => {
  it('posts session_id to /api/billing/confirm when present on mount', async () => {
    searchParamsValue = new URLSearchParams('session_id=cs_test_123')
    const fetchMock = mockFetch({
      '/api/billing/usage': USAGE_RESPONSE,
      '/api/billing/plans': PLANS_RESPONSE,
      'POST /api/billing/confirm': { activated: true },
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<BillingSettings />)

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/billing/confirm')
      expect(call).toBeDefined()
      expect(call?.[1]).toEqual(
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ sessionId: 'cs_test_123' }),
        })
      )
    })
  })

  it('calls update() only after the confirm POST resolves, not before', async () => {
    searchParamsValue = new URLSearchParams('session_id=cs_test_123')
    let resolveConfirm: (value: unknown) => void = () => {}
    const confirmPromise = new Promise((resolve) => {
      resolveConfirm = resolve
    })
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/billing/confirm') {
        await confirmPromise
        return { ok: true, json: async () => ({ activated: true }) } as Response
      }
      if (url === '/api/billing/usage') return { ok: true, json: async () => USAGE_RESPONSE } as Response
      if (url === '/api/billing/plans') return { ok: true, json: async () => PLANS_RESPONSE } as Response
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<BillingSettings />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/billing/confirm', expect.anything()))
    expect(mockUpdate).not.toHaveBeenCalled()

    await act(async () => {
      resolveConfirm(undefined)
    })

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
  })

  it('removes session_id from the URL after confirming', async () => {
    searchParamsValue = new URLSearchParams('session_id=cs_test_123&tab=assinatura')
    const fetchMock = mockFetch({
      '/api/billing/usage': USAGE_RESPONSE,
      '/api/billing/plans': PLANS_RESPONSE,
      'POST /api/billing/confirm': { activated: true },
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<BillingSettings />)

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/configuracoes?tab=assinatura', { scroll: false })
    })
  })

  it('does not POST to /api/billing/confirm when there is no session_id', async () => {
    const fetchMock = mockFetch({
      '/api/billing/usage': USAGE_RESPONSE,
      '/api/billing/plans': PLANS_RESPONSE,
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<BillingSettings />)

    await waitFor(() => expect(screen.getByText('Pro')).toBeInTheDocument())

    expect(fetchMock.mock.calls.some(([url]) => url === '/api/billing/confirm')).toBe(false)
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('does not surface an error to the user when the confirm POST fails', async () => {
    searchParamsValue = new URLSearchParams('session_id=cs_test_123')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/billing/confirm') {
        return { ok: false, status: 500, json: async () => ({ error: 'boom' }) } as Response
      }
      if (url === '/api/billing/usage') return { ok: true, json: async () => USAGE_RESPONSE } as Response
      if (url === '/api/billing/plans') return { ok: true, json: async () => PLANS_RESPONSE } as Response
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<BillingSettings />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/billing/confirm', expect.anything()))
    await waitFor(() => expect(screen.getByText('Pro')).toBeInTheDocument())

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(/erro/i)).not.toBeInTheDocument()

    consoleError.mockRestore()
  })
})

/**
 * Cancel and reactivate are the same slot. `canCancel` requires a status that
 * is not `canceled`; `canReactivate` requires exactly that status with the
 * period still open, so they cannot both be true. This pins that, and pins
 * which one shows in each state, because the banner sends people here
 * expecting to find "Reativar".
 */
describe('BillingSettings cancel and reactivate', () => {
  function renderWith(subscription: Record<string, unknown>) {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/billing/usage') {
        return {
          ok: true,
          json: async () => ({ ...USAGE_RESPONSE, subscription }),
        } as Response
      }
      if (url === '/api/billing/plans') return { ok: true, json: async () => PLANS_RESPONSE } as Response
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<BillingSettings />)
    return fetchMock
  }

  const FUTURE = '2999-01-01T00:00:00.000Z'
  const PAST = '2020-01-01T00:00:00.000Z'

  it('offers cancel on a live subscription, and not reactivate', async () => {
    renderWith({ ...USAGE_RESPONSE.subscription })

    await waitFor(() => expect(screen.getByText('Cancelar assinatura')).toBeInTheDocument())
    expect(screen.queryByText('Reativar assinatura')).not.toBeInTheDocument()
  })

  it('offers reactivate while a cancellation is pending, and not cancel', async () => {
    renderWith({
      ...USAGE_RESPONSE.subscription,
      status: 'canceled',
      currentPeriodEnd: FUTURE,
    })

    await waitFor(() => expect(screen.getByText('Reativar assinatura')).toBeInTheDocument())
    expect(screen.queryByText('Cancelar assinatura')).not.toBeInTheDocument()
  })

  it('offers neither once the cancelled period has closed', async () => {
    // Stripe has ended it, so there is nothing to resume and nothing to
    // cancel. The way back is buying a plan again.
    renderWith({
      ...USAGE_RESPONSE.subscription,
      status: 'canceled',
      currentPeriodEnd: PAST,
    })

    await waitFor(() => expect(screen.getByText('Pro')).toBeInTheDocument())
    expect(screen.queryByText('Reativar assinatura')).not.toBeInTheDocument()
    expect(screen.queryByText('Cancelar assinatura')).not.toBeInTheDocument()
  })

  it('posts to the reactivate route and refreshes the session', async () => {
    const fetchMock = renderWith({
      ...USAGE_RESPONSE.subscription,
      status: 'canceled',
      currentPeriodEnd: FUTURE,
    })

    await waitFor(() => expect(screen.getByText('Reativar assinatura')).toBeInTheDocument())
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/billing/reactivate') return { ok: true, json: async () => ({ success: true }) } as Response
      if (url === '/api/billing/usage') return { ok: true, json: async () => USAGE_RESPONSE } as Response
      if (url === '/api/billing/plans') return { ok: true, json: async () => PLANS_RESPONSE } as Response
      throw new Error(`unexpected fetch: ${url}`)
    })

    await act(async () => {
      screen.getByText('Reativar assinatura').click()
    })

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/billing/reactivate', { method: 'POST' }),
    )
    // The gate reads subscriptionStatus off the JWT, so the row alone is not
    // enough to unblock this browser.
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
  })
})

/**
 * A lapsed customer could buy any plan except the one they wanted back.
 *
 * The card for the plan on the row renders as "current" and drops its button.
 * That is right while the subscription is live, and wrong once it has lapsed:
 * the status stays `canceled` with the old `planId` forever, so a Starter
 * customer whose period closed was offered Pro and nothing else.
 */
describe('BillingSettings plan cards after a lapse', () => {
  const PLANS = {
    data: [
      { id: 'p1', slug: 'starter', name: 'Starter', priceCents: 9900, features: {}, limits: {} },
      { id: 'p2', slug: 'pro', name: 'Pro', priceCents: 19900, features: {}, limits: {} },
    ],
  }

  function renderWith(subscription: Record<string, unknown>, plan: Record<string, unknown>) {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/billing/usage') {
        return { ok: true, json: async () => ({ ...USAGE_RESPONSE, subscription, plan }) } as Response
      }
      if (url === '/api/billing/plans') return { ok: true, json: async () => PLANS } as Response
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<BillingSettings />)
  }

  const STARTER = { name: 'Starter', slug: 'starter', priceCents: 9900, features: {} }

  it('leaves the current plan inert while the subscription is live', async () => {
    renderWith(
      { ...USAGE_RESPONSE.subscription, status: 'active' },
      STARTER,
    )

    // Only Pro is buyable: Starter is what they are on.
    await waitFor(() => expect(screen.getAllByRole('button', { name: /assinar|mudar/i })).toHaveLength(1))
  })

  it('leaves the current plan inert while a charge is being retried', async () => {
    // past_due still has a live Stripe subscription. Offering "Assinar" on
    // the plan they are on would open a second one.
    renderWith(
      {
        ...USAGE_RESPONSE.subscription,
        status: 'past_due',
        currentPeriodEnd: '2999-01-01T00:00:00.000Z',
      },
      STARTER,
    )

    await waitFor(() => expect(screen.getAllByRole('button', { name: /assinar|mudar/i })).toHaveLength(1))
  })

  it('makes the old plan buyable again once the subscription has lapsed', async () => {
    renderWith(
      {
        ...USAGE_RESPONSE.subscription,
        status: 'canceled',
        currentPeriodEnd: '2020-01-01T00:00:00.000Z',
      },
      STARTER,
    )

    await waitFor(() => expect(screen.getAllByRole('button', { name: /assinar/i })).toHaveLength(2))
  })
})

describe('BillingSettings — a running discount (win-back coupon)', () => {
  function renderWithDiscount(discount: Record<string, unknown> | null) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/billing/usage') {
          return {
            ok: true,
            json: async () => ({
              ...USAGE_RESPONSE,
              plan: { name: 'Starter', slug: 'starter', priceCents: 9900, features: {} },
              discount,
            }),
          } as Response
        }
        if (url === '/api/billing/plans') {
          return {
            ok: true,
            json: async () => ({
              data: [{ id: 'p1', slug: 'starter', name: 'Starter', priceCents: 9900, features: {}, limits: {} }],
            }),
          } as Response
        }
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )
    render(<BillingSettings />)
  }

  const year = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric' }))

  it('shows the discounted price and when it ends, on the plan and its card', async () => {
    // 01:00 UTC on 31/12 is still 30/12 in São Paulo.
    renderWithDiscount({ discountedCents: 6930, fullCents: 9900, duration: 'repeating', endsAt: `${year}-12-31T01:00:00.000Z` })
    expect(await screen.findByTestId('billing-discounted-price')).toHaveTextContent(
      'R$ 69,30/mês até 30/12, depois R$ 99,00',
    )
    expect(screen.getAllByText('R$ 69,30/mês até 30/12, depois R$ 99,00')).toHaveLength(2)
    expect(screen.queryByText('R$ 99,00/mês')).toBeNull()
  })

  it('carries the year when the discount ends in another one', async () => {
    renderWithDiscount({ discountedCents: 6930, fullCents: 9900, duration: 'repeating', endsAt: `${year + 1}-02-10T15:00:00.000Z` })
    expect(await screen.findByTestId('billing-discounted-price')).toHaveTextContent(
      `R$ 69,30/mês até 10/02/${year + 1}, depois R$ 99,00`,
    )
  })

  it('shows the plain price without a discount', async () => {
    renderWithDiscount(null)
    expect(await screen.findByText('R$ 99,00/mês')).toBeInTheDocument()
    expect(screen.queryByTestId('billing-discounted-price')).toBeNull()
  })
})

describe('BillingSettings — referral program', () => {
  const OFFER = {
    kind: 'referral',
    referrerName: 'Clínica Flor',
    label: '20% de desconto nos 2 primeiros meses',
    percentOff: 20,
    amountOffCents: null,
    duration: 'repeating',
    durationInMonths: 2,
    planSlugs: ['starter'],
    headline: 'Indicação de Clínica Flor: 20% de desconto nos 2 primeiros meses.',
  }
  const TRIAL_USAGE = {
    ...USAGE_RESPONSE,
    subscription: { ...USAGE_RESPONSE.subscription, status: 'trialing', stripeSubscriptionId: null, hasStripeCustomer: false },
    plan: { name: 'Starter', slug: 'starter', priceCents: 9900, features: {} },
  }
  const PLANS = { data: [{ id: 'p1', slug: 'starter', name: 'Starter', priceCents: 9900, features: {}, limits: {} }] }

  function setup(usageBodies: Array<Record<string, unknown>>, attach?: () => Response) {
    let usageCalls = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/billing/usage') {
        const body = usageBodies[Math.min(usageCalls++, usageBodies.length - 1)]
        return { ok: true, json: async () => body } as Response
      }
      if (url === '/api/billing/plans') return { ok: true, json: async () => PLANS } as Response
      if (url === '/api/referral/attach' && init?.method === 'POST' && attach) return attach()
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<BillingSettings />)
    return fetchMock
  }
  const usageCalls = (m: ReturnType<typeof setup>) => m.mock.calls.filter((c) => c[0] === '/api/billing/usage').length

  it('notes the referral bonus under the WhatsApp credits', async () => {
    setup([{ ...USAGE_RESPONSE, usage: { ...USAGE_RESPONSE.usage, whatsapp: { used: 1, limit: 250, bonus: 50 } } }])
    expect(await screen.findByTestId('usage-note')).toHaveTextContent('inclui +50 créditos de indicação')
  })

  it('shows no bonus note without a bonus', async () => {
    setup([USAGE_RESPONSE])
    await screen.findByText('Plano atual')
    expect(screen.queryByTestId('usage-note')).toBeNull()
  })

  it('shows the offer banner and the struck plan price', async () => {
    setup([{ ...TRIAL_USAGE, referral: { offer: OFFER, canEnterCode: false } }])
    expect(await screen.findByTestId('referral-offer-banner')).toHaveTextContent(OFFER.headline)
    const price = await screen.findByTestId('referral-plan-price')
    expect(price).toHaveTextContent('R$ 99,00')
    expect(price).toHaveTextContent('R$ 79,20/mês')
    expect(price).toHaveTextContent('nos 2 primeiros meses')
  })

  it('renders the referral discount line', async () => {
    setup([
      {
        ...USAGE_RESPONSE,
        plan: { name: 'Starter', slug: 'starter', priceCents: 9900, features: {} },
        discount: { discountedCents: 5940, fullCents: 9900, duration: 'forever', endsAt: null, referralPercent: 40, afterEndsCents: null },
      },
    ])
    expect(await screen.findByTestId('billing-discounted-price')).toHaveTextContent(
      'R$ 99,00 → R$ 59,40/mês · 40% de desconto por 2 indicações pagantes',
    )
  })

  it('posts the code to attach, refetches usage and drops the card', async () => {
    const m = setup(
      [
        { ...TRIAL_USAGE, referral: { offer: null, canEnterCode: true } },
        { ...TRIAL_USAGE, referral: { offer: OFFER, canEnterCode: false } },
      ],
      () => ({ ok: true, status: 200, json: async () => ({ status: 'trial' }) }) as Response,
    )
    expect(await screen.findByText('Tem um código de indicação?')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Código de indicação'), { target: { value: ' MECA7K ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar código' }))

    await waitFor(() => expect(usageCalls(m)).toBe(2))
    const attach = m.mock.calls.find((c) => c[0] === '/api/referral/attach')!
    expect(JSON.parse(attach[1]!.body as string)).toEqual({ code: 'MECA7K' })
    expect(toast.success).toHaveBeenCalledWith('Indicação registrada')
    await waitFor(() => expect(screen.queryByText('Tem um código de indicação?')).toBeNull())
    expect(await screen.findByTestId('referral-offer-banner')).toBeInTheDocument()
  })

  it('explains an ineligible referral', async () => {
    setup(
      [{ ...TRIAL_USAGE, referral: { offer: null, canEnterCode: true } }],
      () => ({ ok: true, status: 200, json: async () => ({ status: 'ineligible' }) }) as Response,
    )
    fireEvent.change(await screen.findByLabelText('Código de indicação'), { target: { value: 'MECA7K' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar código' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Esta indicação não é elegível pelas regras do programa.'),
    )
  })

  it('shows the server message on a 400', async () => {
    setup(
      [{ ...TRIAL_USAGE, referral: { offer: null, canEnterCode: true } }],
      () => ({ ok: false, status: 400, json: async () => ({ error: 'Código inválido' }) }) as Response,
    )
    fireEvent.change(await screen.findByLabelText('Código de indicação'), { target: { value: 'XXXX' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar código' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Código inválido'))
  })

  it('hides the code card when the program is off', async () => {
    setup([{ ...TRIAL_USAGE, referral: { offer: null, canEnterCode: false } }])
    await screen.findByText('Plano atual')
    expect(screen.queryByText('Tem um código de indicação?')).toBeNull()
  })
})
