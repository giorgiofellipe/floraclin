import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionPicker } from '../session-picker'

beforeEach(() => {
  global.fetch = vi.fn() as unknown as typeof fetch
})

type AtendimentoView = {
  records: Array<{
    id: string
    procedureTypeName: string
    sessionsTotal: number
    sessions: Array<{
      id: string
      sessionOrdinal: number
      performedAt: string
      executedByName: string
    }>
  }>
  package: {
    id: string
    name: string
    expiresAt: string | null
    status: string
    closedAt: string | null
    closedReason: string | null
  } | null
}

const mockAtendimentoView = (view: AtendimentoView) => {
  ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
    new Response(JSON.stringify({ success: true, data: view }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

const renderPicker = (overrides: Partial<React.ComponentProps<typeof SessionPicker>> = {}) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SessionPicker
        atendimentoId="atend-1"
        procedureRecordIds={['rec-1']}
        packageId={null}
        onPickPending={vi.fn()}
        onPickExecuted={vi.fn()}
        {...overrides}
      />
    </QueryClientProvider>,
  )
}

describe('<SessionPicker>', () => {
  it('shows "Executar agora" only on the lowest pending ordinal per line', async () => {
    mockAtendimentoView({
      records: [
        {
          id: 'rec-1',
          procedureTypeName: 'Botox',
          sessionsTotal: 4,
          sessions: [
            {
              id: 'sess-1',
              sessionOrdinal: 1,
              performedAt: '2026-01-01T12:00:00.000Z',
              executedByName: 'Dra. Ana',
            },
            {
              id: 'sess-2',
              sessionOrdinal: 2,
              performedAt: '2026-01-15T12:00:00.000Z',
              executedByName: 'Dra. Ana',
            },
          ],
        },
      ],
      package: null,
    })

    renderPicker()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Executar agora' })).toBeInTheDocument()
    })

    // Exactly one "Executar agora" button — for ordinal 3, NOT for ordinal 4.
    const buttons = screen.getAllByRole('button', { name: 'Executar agora' })
    expect(buttons).toHaveLength(1)

    // Ordinal 4 should render "Pendente" instead.
    expect(screen.getAllByText('Pendente').length).toBeGreaterThanOrEqual(1)
  })

  it('disables actions when package is closed', async () => {
    mockAtendimentoView({
      records: [
        {
          id: 'rec-1',
          procedureTypeName: 'Botox',
          sessionsTotal: 3,
          sessions: [],
        },
      ],
      package: {
        id: 'pkg-1',
        name: 'Pacote Botox',
        expiresAt: null,
        status: 'completed',
        closedAt: '2026-01-20T12:00:00.000Z',
        closedReason: 'Concluído',
      },
    })

    renderPicker({ packageId: 'pkg-1' })

    await waitFor(() => {
      expect(screen.getAllByText('Pendente').length).toBeGreaterThan(0)
    })

    expect(screen.queryByRole('button', { name: 'Executar agora' })).not.toBeInTheDocument()
  })

  it('shows expiry banner when expiresAt is in the past and not closed', async () => {
    mockAtendimentoView({
      records: [
        {
          id: 'rec-1',
          procedureTypeName: 'Botox',
          sessionsTotal: 2,
          sessions: [],
        },
      ],
      package: {
        id: 'pkg-1',
        name: 'Pacote Botox',
        expiresAt: '2020-01-01',
        status: 'active',
        closedAt: null,
        closedReason: null,
      },
    })

    renderPicker({ packageId: 'pkg-1' })

    await waitFor(() => {
      expect(screen.getByText(/Pacote vencido em/)).toBeInTheDocument()
    })
  })

  it('hides expiry banner when the package has been closed', async () => {
    mockAtendimentoView({
      records: [
        {
          id: 'rec-1',
          procedureTypeName: 'Botox',
          sessionsTotal: 2,
          sessions: [],
        },
      ],
      package: {
        id: 'pkg-1',
        name: 'Pacote Botox',
        expiresAt: '2020-01-01',
        status: 'completed',
        closedAt: '2026-01-20T12:00:00.000Z',
        closedReason: 'Encerrado',
      },
    })

    renderPicker({ packageId: 'pkg-1' })

    // Wait for loading to clear, then confirm banner absent.
    await waitFor(() => {
      expect(screen.getAllByText('Pendente').length).toBeGreaterThan(0)
    })

    expect(screen.queryByText(/Pacote vencido em/)).not.toBeInTheDocument()
  })
})
