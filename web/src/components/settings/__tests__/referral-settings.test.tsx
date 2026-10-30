import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders as render } from '@/tests/test-utils'
import { ReferralSettings } from '../referral-settings'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from 'sonner'
vi.mock('@/lib/analytics/client', () => ({ track: vi.fn() }))
import { track } from '@/lib/analytics/client'

const ACTIVE = {
  canRefer: true,
  enrollmentOpen: true,
  subscribeToUnlock: false,
  discountPercent: 40,
  monthlySavingsCents: 3960,
  inactiveMessage: null,
  code: 'MECA7K',
  link: 'https://floraclin.com.br/indicacao/MECA7K',
  shareText: 'texto de compartilhamento',
  whatsappShareUrl: 'https://wa.me/?text=texto',
  progress: { counting: 2, target: 5, percent: 40, label: '2 de 5 clínicas pagantes, faltam 3 para FloraClin grátis', bonusLabel: null },
  discountLine: 'linha de desconto',
  referrals: [{ id: 'r1', name: 'Clínica A', signupDate: '02/10/2026', status: 'paused', label: 'pagante', sublabel: 'pagamento pendente' }],
  history: [{ date: '20/10/2026', text: 'desconto de 40% com 2 clínicas pagantes' }],
  rulesUrl: 'https://floraclin.com.br/indique',
}
const INACTIVE = {
  ...ACTIVE,
  canRefer: false,
  discountPercent: 0,
  monthlySavingsCents: null,
  inactiveMessage: 'Seu link de indicação fica ativo quando sua clínica tem uma assinatura paga.',
  code: null,
  link: null,
  shareText: null,
  whatsappShareUrl: null,
}

const writeText = vi.fn()

function mockResponse(body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => body }))
}

beforeEach(() => {
  vi.clearAllMocks()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('ReferralSettings', () => {
  it('renders the link and buttons, copying the link and the share text', async () => {
    mockResponse(ACTIVE)
    render(<ReferralSettings />)

    expect(await screen.findByText(ACTIVE.link)).toBeTruthy()
    expect(screen.getByText('Compartilhar no WhatsApp')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Personalizar código' })).toBeTruthy()
    expect(screen.getByText('Clínica A')).toBeTruthy()
    expect(screen.getByText('pagamento pendente')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ver regras do programa' }).getAttribute('href')).toBe(ACTIVE.rulesUrl)

    fireEvent.click(screen.getByRole('button', { name: 'Copiar link' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Link copiado'))
    expect(writeText).toHaveBeenCalledWith(ACTIVE.link)

    fireEvent.click(screen.getByRole('button', { name: 'Copiar texto para Instagram' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Texto copiado'))
    expect(writeText).toHaveBeenCalledWith(ACTIVE.shareText)
  })

  it('shows the inactive message and no share buttons when the clinic cannot refer', async () => {
    mockResponse(INACTIVE)
    render(<ReferralSettings />)

    expect(await screen.findByText(INACTIVE.inactiveMessage)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copiar link' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Personalizar código' })).toBeNull()
    expect(screen.getByText('Clínica A')).toBeTruthy()
  })

  it('leads with how many clinics are left, the current percent and what it saves', async () => {
    mockResponse(ACTIVE)
    render(<ReferralSettings />)
    expect(await screen.findByText('Faltam 3 clínicas para o FloraClin grátis')).toBeTruthy()
    expect(screen.getByText('R$ 39,60/mês a menos').parentElement?.textContent).toBe('40%R$ 39,60/mês a menos')
    expect(screen.getByRole('listitem', { current: 'step' }).textContent).toContain('60%')
  })

  it('offers subscribing to unlock the link to a trial clinic, without a link or referral list', async () => {
    mockResponse({ ...INACTIVE, subscribeToUnlock: true, referrals: [] })
    render(<ReferralSettings />)
    expect(await screen.findByText('Ganhe até 100% de desconto')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Assinar e desbloquear meu link' }).getAttribute('href')).toBe(
      '/configuracoes?tab=assinatura',
    )
    expect(screen.queryByRole('button', { name: 'Copiar link' })).toBeNull()
    expect(screen.queryByText('Clínicas indicadas')).toBeNull()
  })

  it.each([
    ['?tab=indique&from=launch_email', ACTIVE, { source: 'launch_email', state: 'sharing', counting: 2 }],
    ['?tab=indique', INACTIVE, { source: 'direct', state: 'inactive', counting: 2 }],
    ['?tab=indique&from=somewhere', { ...INACTIVE, subscribeToUnlock: true }, { source: 'direct', state: 'subscribe_to_unlock', counting: 2 }],
  ])('reports the page view with its source and state for %s', async (search, body, expected) => {
    window.history.replaceState(null, '', `/configuracoes${search}`)
    mockResponse(body)
    render(<ReferralSettings />)
    await waitFor(() => expect(track).toHaveBeenCalledTimes(1))
    expect(track).toHaveBeenCalledWith('referral_page_viewed', expected)
  })

  it('counts a link source once: the next visit in the same tab is direct', async () => {
    window.history.replaceState(null, '', '/configuracoes?tab=indique&from=sidebar_card')
    mockResponse(ACTIVE)
    const first = render(<ReferralSettings />)
    await waitFor(() => expect(track).toHaveBeenCalledTimes(1))
    expect(window.location.search).toBe('?tab=indique')
    first.unmount()

    render(<ReferralSettings />)
    await waitFor(() => expect(track).toHaveBeenCalledTimes(2))
    expect(vi.mocked(track).mock.calls).toEqual([
      ['referral_page_viewed', expect.objectContaining({ source: 'sidebar_card' })],
      ['referral_page_viewed', expect.objectContaining({ source: 'direct' })],
    ])
  })
})
