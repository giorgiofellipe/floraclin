import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/tests/test-utils'
import { QuoteHistory } from '../quote-history'

function stubQuotes(quotes: Array<Record<string, unknown>>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: quotes }) }),
  )
}

const base = { groupId: 'g1', total: 100, url: null, createdAt: '2026-11-03T15:00:00.000Z' }

describe('QuoteHistory', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows the WhatsApp send date as the BR day, not the UTC day', async () => {
    stubQuotes([
      { ...base, id: 'q1', whatsappStatus: 'sent', whatsappRequestedAt: '2026-11-03T01:00:00.000Z' },
    ])
    renderWithProviders(<QuoteHistory groupId="g1" />)

    expect(await screen.findByText('Enviado por WhatsApp em 02/11/2026')).toBeInTheDocument()
  })

  it('shows the queued WhatsApp date as the BR day, not the UTC day', async () => {
    stubQuotes([
      { ...base, id: 'q1', whatsappStatus: 'queued', whatsappRequestedAt: '2026-11-03T01:00:00.000Z' },
    ])
    renderWithProviders(<QuoteHistory groupId="g1" />)

    expect(await screen.findByText('Na fila do WhatsApp desde 02/11/2026')).toBeInTheDocument()
  })

  it('shows no WhatsApp note when the quote was never sent', async () => {
    stubQuotes([{ ...base, id: 'q1', whatsappStatus: null, whatsappRequestedAt: null }])
    renderWithProviders(<QuoteHistory groupId="g1" />)

    await screen.findByText(/03\/11\/2026/)
    expect(screen.queryByText(/WhatsApp/)).toBeNull()
  })
})
