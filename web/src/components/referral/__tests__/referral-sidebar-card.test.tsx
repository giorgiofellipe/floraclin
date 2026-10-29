import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders as render } from '@/tests/test-utils'
import { ReferralSidebarCard } from '../referral-sidebar-card'

const PAYING = {
  canRefer: true,
  enrollmentOpen: true,
  subscribeToUnlock: false,
  discountPercent: 20,
  monthlySavingsCents: 1980,
  link: 'https://floraclin.com.br/indicacao/BELLAFACE',
  whatsappShareUrl: 'https://wa.me/?text=oi',
  progress: { counting: 1, target: 5, percent: 20, label: '', bonusLabel: null },
}
const TRIAL = { ...PAYING, canRefer: false, subscribeToUnlock: true, discountPercent: 0, link: null, whatsappShareUrl: null }

const writeText = vi.fn()

function respond(status: number, body: unknown = {}) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: status === 200, status, json: async () => body }))
}

beforeEach(() => {
  localStorage.clear()
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => vi.unstubAllGlobals())

describe('ReferralSidebarCard', () => {
  it.each([
    [1, '20% OFF', 'Indique e Ganhe', '1 de 5 · faltam 4 para grátis'],
    [4, '80% OFF', 'Indique e Ganhe', '4 de 5 · falta 1 para grátis'],
    [6, 'GRÁTIS', 'FloraClin grátis 🎉', '+100 créditos WhatsApp por nova clínica'],
  ])('shows the short, full copy for %i counting referrals', async (counting, tag, title, line) => {
    respond(200, { ...PAYING, discountPercent: Math.min(counting, 5) * 20, progress: { ...PAYING.progress, counting } })
    render(<ReferralSidebarCard />)
    expect(await screen.findByText(title)).toBeTruthy()
    expect(screen.getByText(tag)).toBeTruthy()
    expect(screen.getByText(line)).toBeTruthy()
  })

  it('copies the referral link from the card and confirms it', async () => {
    respond(200, PAYING)
    render(<ReferralSidebarCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Copiar link' }))
    await waitFor(() => expect(screen.getByText('Copiado')).toBeTruthy())
    expect(writeText).toHaveBeenCalledWith(PAYING.link)
    expect(screen.getByRole('link', { name: 'Compartilhar no WhatsApp' }).getAttribute('href')).toBe(PAYING.whatsappShareUrl)
  })

  it('asks a trial clinic to subscribe, linking to the billing tab', async () => {
    respond(200, TRIAL)
    render(<ReferralSidebarCard />)
    expect(await screen.findByText('Ganhe até 100%')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Assinar' }).getAttribute('href')).toBe('/configuracoes?tab=assinatura')
    expect(screen.queryByRole('button', { name: 'Copiar link' })).toBeNull()
  })

  it.each([
    ['the program is off for the clinic', 404, {}],
    ['a gifted clinic, which can neither share nor subscribe', 200, { ...TRIAL, subscribeToUnlock: false }],
    ['enrollment closed (only the dashboard stays)', 200, { ...PAYING, enrollmentOpen: false, link: null }],
  ])('renders nothing when %s', async (_n, status, body) => {
    respond(status, body)
    const { container } = render(<ReferralSidebarCard />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await act(async () => {})
    expect(container.textContent).toBe('')
  })

  it('collapses to one line when hidden, stays collapsed on the next load, and reopens', async () => {
    respond(200, PAYING)
    const first = render(<ReferralSidebarCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ocultar Indique e Ganhe' }))
    expect(screen.getByRole('button', { name: 'Indique e Ganhe · 20%' })).toBeTruthy()
    first.unmount()

    render(<ReferralSidebarCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Indique e Ganhe · 20%' }))
    expect(screen.getByRole('button', { name: 'Copiar link' })).toBeTruthy()
  })
})
