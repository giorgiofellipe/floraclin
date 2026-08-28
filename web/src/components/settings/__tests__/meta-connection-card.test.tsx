import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MetaConnectionCard } from '../meta-connection-card'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const BASE_CONNECTION: {
  id: string
  datasetId: string
  businessId: string | null
  connectionType: 'oauth' | 'manual'
  tokenExpiresAt: string | null
  testEventCode: string | null
  advancedMatchingEnabled: boolean
  status: string
  acknowledgedAt: string | null
  acknowledgementVersion: string | null
  lastVerifiedAt: string | null
  lastErrorAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
} = {
  id: 'conn-1',
  datasetId: 'dataset-1',
  businessId: null,
  connectionType: 'manual',
  tokenExpiresAt: null,
  testEventCode: null,
  advancedMatchingEnabled: true,
  status: 'active',
  acknowledgedAt: '2026-08-01T12:00:00.000Z',
  acknowledgementVersion: '2026-08-v1',
  lastVerifiedAt: null,
  lastErrorAt: null,
  lastError: null,
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
}

function mockConnectionResponse(body: { data: typeof BASE_CONNECTION | null; events: unknown[] }) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MetaConnectionCard />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MetaConnectionCard: not connected', () => {
  it('keeps the connect button disabled until the LGPD acknowledgement is checked', async () => {
    vi.stubGlobal('fetch', mockConnectionResponse({ data: null, events: [] }))

    renderCard()

    const connectButton = await screen.findByRole('button', { name: /conectar meta/i })
    expect(connectButton).toBeDisabled()

    const checkbox = screen.getByRole('checkbox')
    await userEvent.click(checkbox)

    await waitFor(() => expect(connectButton).not.toBeDisabled())
  })
})

describe('MetaConnectionCard: invalid token', () => {
  it('renders a warning banner when the connection status is invalid_token', async () => {
    vi.stubGlobal(
      'fetch',
      mockConnectionResponse({
        data: { ...BASE_CONNECTION, status: 'invalid_token', lastError: 'token expirado' },
        events: [],
      }),
    )

    renderCard()

    expect(await screen.findByText(/token da meta expirou ou foi revogado/i)).toBeInTheDocument()
  })
})

describe('MetaConnectionCard: diagnostics', () => {
  it('renders a skipped event row together with its skip reason', async () => {
    vi.stubGlobal(
      'fetch',
      mockConnectionResponse({
        data: BASE_CONNECTION,
        events: [
          {
            id: 'evt-1',
            prospectId: 'prospect-1',
            eventName: 'Lead',
            eventId: 'lead:prospect-1',
            status: 'skipped',
            skipReason: 'opted_out',
            attempts: 0,
            lastError: null,
            fbTraceId: null,
            sentAt: null,
            createdAt: '2026-08-20T10:00:00.000Z',
          },
        ],
      }),
    )

    renderCard()

    expect(await screen.findByText('Ignorado')).toBeInTheDocument()
    expect(screen.getByText('opted_out')).toBeInTheDocument()
  })
})
