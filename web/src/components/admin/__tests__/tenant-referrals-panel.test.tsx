import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders as render } from '@/tests/test-utils'
import { TenantReferralsPanel, summarizeChecks } from '../tenant-referrals-panel'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const fetchMock = vi.fn()

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    referredName: 'Clínica Alfa',
    status: 'paused',
    pausedReason: 'past_due',
    ineligibleReason: null,
    capturedVia: 'link',
    capturedAt: '2099-01-10T15:00:00.000Z',
    qualifiedAt: null,
    checks: { atSignup: { selfReferral: ['phone'], notNew: [] } },
    ...over,
  }
}

const view = {
  code: 'MECA7K',
  referredBy: { ...row({ id: 'r0', status: 'counting', pausedReason: null }), referrerName: 'Clínica Mãe' },
  referrals: [row(), row({ id: 'r2', referredName: 'Clínica Beta', status: 'ineligible', pausedReason: null, ineligibleReason: 'admin' })],
  events: [{ id: 'e1', createdAt: '2099-01-12T15:00:00.000Z', counting: 2, discountPercent: 40, bonusCredits: 100, reason: 'referral_counting' }],
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? { ok: true, json: async () => ({ data: { status: 'ineligible' } }) }
      : { ok: true, json: async () => ({ data: view }) },
  )
})

describe('TenantReferralsPanel', () => {
  it('renders the code, referrer, rows with B1 labels, checks and reward history', async () => {
    render(<TenantReferralsPanel tenantId="t1" />)
    expect(await screen.findByText('MECA7K')).toBeTruthy()
    expect(screen.getByText('Clínica Mãe')).toBeTruthy()
    expect(screen.getByText('pagante (pagamento pendente)')).toBeTruthy()
    expect(screen.getByText('não elegível (não atende às regras do programa)')).toBeTruthy()
    expect(screen.getAllByText('cadastro: mesma pessoa (telefone)')).toHaveLength(2)
    expect(screen.getByText(/2 contando, 40%, \+100 créditos/)).toBeTruthy()
    // only the non-terminal row offers the action
    expect(screen.getAllByRole('button', { name: 'Marcar indicação como não elegível' })).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/tenants/t1/referrals')
  })

  it('confirm posts the trimmed note and refetches', async () => {
    render(<TenantReferralsPanel tenantId="t1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar indicação como não elegível' }))
    fireEvent.change(await screen.findByLabelText('Motivo'), { target: { value: '  mesma pessoa  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/referrals/r1/ineligible',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ note: 'mesma pessoa' }) }),
      ),
    )
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, i]) => !i).length).toBe(2))
  })
})

describe('summarizeChecks', () => {
  it('says "sem alertas" for clean checks and lists not-new matches', () => {
    expect(summarizeChecks({})).toBe('sem alertas')
    expect(
      summarizeChecks({ atCheckout: { selfReferral: [], notNew: [{ tenantId: 'x', signals: ['card', 'registry'] }] } }),
    ).toBe('checkout: já cliente (cartão, registro)')
  })
})
