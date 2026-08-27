/**
 * Stripe sends the customer back to success_url as soon as the card clears;
 * the webhook can arrive later. Meanwhile subscriptionStatus lives in the
 * JWT and only refreshes on sign-in or an explicit session.update(). These
 * tests guard the fix: mounting with a session_id posts it to
 * /api/billing/confirm, refreshes the session only after that resolves, and
 * always cleans the id out of the URL so a refresh cannot re-post it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, act } from '@testing-library/react'
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

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'authenticated', update: mockUpdate }),
}))

// ─── Fixtures ──────────────────────────────────────────────────────

const USAGE_RESPONSE = {
  subscription: {
    status: 'active',
    currentPeriodEnd: '2026-09-27T00:00:00.000Z',
    stripeSubscriptionId: 'sub_123',
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
