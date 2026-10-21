import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders as render } from '@/tests/test-utils'
import { ReferralSettings } from '../referral-settings'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from 'sonner'

const ACTIVE = {
  canRefer: true,
  inactiveMessage: null,
  link: 'https://floraclin.com.br/indicacao/MECA7K',
  shareText: 'texto de compartilhamento',
  whatsappShareUrl: 'https://wa.me/?text=texto',
  progress: { counting: 2, target: 5, percent: 40, label: '2 de 5 clínicas pagantes, faltam 3 para FloraClin grátis', bonusLabel: null },
  discountLine: 'linha de desconto',
  referrals: [{ id: 'r1', name: 'Clínica A', signupDate: '02/10/2026', label: 'pagante', sublabel: 'pagamento pendente' }],
  history: [{ date: '20/10/2026', text: 'desconto de 40% com 2 clínicas pagantes' }],
  rulesUrl: 'https://floraclin.com.br/indique',
}
const INACTIVE = {
  ...ACTIVE,
  canRefer: false,
  inactiveMessage: 'Seu link de indicação fica ativo quando sua clínica tem uma assinatura paga.',
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
afterEach(() => vi.unstubAllGlobals())

describe('ReferralSettings', () => {
  it('renders the link and buttons, copying the link and the share text', async () => {
    mockResponse(ACTIVE)
    render(<ReferralSettings />)

    expect(await screen.findByText(ACTIVE.link)).toBeTruthy()
    expect(screen.getByText('Compartilhar no WhatsApp')).toBeTruthy()
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
    expect(screen.getByText('Clínica A')).toBeTruthy()
  })
})
