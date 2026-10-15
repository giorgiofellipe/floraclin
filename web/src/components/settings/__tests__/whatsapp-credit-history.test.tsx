import { describe, it, expect, vi, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, screen } from '@/tests/test-utils'
import { WhatsAppCreditHistory } from '../whatsapp-credit-history'

vi.mock('@/hooks/use-is-mobile', () => ({ useIsMobile: () => false }))

const PAGE_1 = {
  periods: [{ id: 'p2', start: '2026-10-01T03:00:00.000Z', end: '2026-11-01T03:00:00.000Z', used: 4, total: 300 }],
  periodId: 'p2',
  entries: [
    { id: 'a', kind: 'spend', amount: -1, refundReason: null, actor: { type: 'user', name: 'Ana Souza' }, recipientName: 'Maria Silva', item: { kind: 'template', label: 'Link de anamnese' }, createdAt: '2026-10-15T13:05:00.000Z' },
    { id: 'b', kind: 'refund', amount: 1, refundReason: 'delivery_failed', actor: { type: 'user', name: 'Ana Souza' }, recipientName: 'Maria Silva', item: { kind: 'template', label: 'Link de anamnese' }, createdAt: '2026-10-15T13:10:00.000Z' },
  ],
  nextCursor: 'c1',
}
const PAGE_2 = { ...PAGE_1, entries: [{ ...PAGE_1.entries[0], id: 'c', recipientName: 'João Lima' }], nextCursor: null }

function respondWith(...bodies: unknown[]) {
  const fetchMock = vi.fn()
  for (const body of bodies) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => body })
  }
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('WhatsAppCreditHistory', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows each line as a sentence with its amount', async () => {
    respondWith(PAGE_1)
    renderWithProviders(<WhatsAppCreditHistory open onOpenChange={() => {}} />)
    expect(await screen.findAllByText('Maria Silva')).toHaveLength(2)
    expect(screen.getByText(/enviou/)).toBeInTheDocument()
    expect(screen.getByText(/não entregou/)).toBeInTheDocument()
    expect(screen.getByText('-1')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('10:05')).toBeInTheDocument()
  })

  it('loads the next page with the cursor', async () => {
    const fetchMock = respondWith(PAGE_1, PAGE_2)
    renderWithProviders(<WhatsAppCreditHistory open onOpenChange={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }))
    expect(await screen.findByText('João Lima')).toBeInTheDocument()
    expect(String(fetchMock.mock.calls[1][0])).toContain('cursor=c1')
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument()
  })

  it('labels an unlimited plan as ilimitado', async () => {
    respondWith({ ...PAGE_1, periods: [{ ...PAGE_1.periods[0], total: -1 }] })
    renderWithProviders(<WhatsAppCreditHistory open onOpenChange={() => {}} />)
    expect(await screen.findByText(/ilimitado/)).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    respondWith({ ...PAGE_1, entries: [], nextCursor: null })
    renderWithProviders(<WhatsAppCreditHistory open onOpenChange={() => {}} />)
    expect(await screen.findByText('Nenhum crédito usado neste período')).toBeInTheDocument()
  })
})
