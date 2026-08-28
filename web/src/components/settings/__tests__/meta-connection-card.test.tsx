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
  function skippedEvent(skipReason: string) {
    return {
      id: 'evt-1',
      prospectId: 'prospect-1',
      eventName: 'Lead',
      eventId: 'lead:prospect-1',
      status: 'skipped',
      skipReason,
      attempts: 0,
      lastError: null,
      fbTraceId: null,
      sentAt: null,
      createdAt: '2026-08-20T10:00:00.000Z',
    }
  }

  it('renders a skipped event row with the skip reason in Portuguese', async () => {
    vi.stubGlobal(
      'fetch',
      mockConnectionResponse({ data: BASE_CONNECTION, events: [skippedEvent('opted_out')] }),
    )

    renderCard()

    expect(await screen.findByText('Ignorado')).toBeInTheDocument()
    expect(screen.getByText('Paciente optou por não compartilhar dados')).toBeInTheDocument()
    expect(screen.queryByText('opted_out')).not.toBeInTheDocument()
  })

  it('labels an internal skip reason for the clinic owner', async () => {
    vi.stubGlobal(
      'fetch',
      mockConnectionResponse({ data: BASE_CONNECTION, events: [skippedEvent('no_external_id_secret')] }),
    )

    renderCard()

    expect(await screen.findByText('Chave de identificação não configurada')).toBeInTheDocument()
    expect(screen.queryByText('no_external_id_secret')).not.toBeInTheDocument()
  })

  it('never leaks an unmapped skip reason', async () => {
    vi.stubGlobal(
      'fetch',
      mockConnectionResponse({ data: BASE_CONNECTION, events: [skippedEvent('something_new')] }),
    )

    renderCard()

    expect(await screen.findByText('Motivo não identificado')).toBeInTheDocument()
    expect(screen.queryByText('something_new')).not.toBeInTheDocument()
  })
})

describe('MetaConnectionCard: connection status', () => {
  it('labels the status in Portuguese instead of the raw database value', async () => {
    vi.stubGlobal(
      'fetch',
      mockConnectionResponse({ data: { ...BASE_CONNECTION, status: 'disabled' }, events: [] }),
    )

    renderCard()

    expect(await screen.findByText('Desativado')).toBeInTheDocument()
    expect(screen.queryByText(/status: disabled/i)).not.toBeInTheDocument()
  })
})

describe('MetaConnectionCard: testing an active connection', () => {
  it('offers the test button while the connection is active', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ events_received: 1 }), { status: 200 })
      }
      return new Response(JSON.stringify({ data: BASE_CONNECTION, events: [] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderCard()

    const testButton = await screen.findByRole('button', { name: /testar conexão/i })
    await userEvent.click(testButton)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/integrations/meta/connection/test', { method: 'POST' }),
    )
  })
})

describe('MetaConnectionCard: advanced matching toggle', () => {
  function toggleFetchMock(connectionType: 'oauth' | 'manual') {
    const stored = { ...BASE_CONNECTION, connectionType }
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ data: stored }), { status: 200 })
      }
      return new Response(JSON.stringify({ data: stored, events: [] }), { status: 200 })
    })
  }

  function findPut(fetchMock: ReturnType<typeof toggleFetchMock>) {
    return fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT')
  }

  it('turns advanced matching off on a manual connection without rewriting the connection type', async () => {
    const fetchMock = toggleFetchMock('manual')
    vi.stubGlobal('fetch', fetchMock)

    renderCard()

    await userEvent.click(await screen.findByRole('switch'))
    await userEvent.click(await screen.findByRole('button', { name: /confirmar/i }))

    await waitFor(() => expect(findPut(fetchMock)).toBeDefined())

    const body = JSON.parse((findPut(fetchMock)?.[1] as RequestInit).body as string)
    expect(body.advancedMatchingEnabled).toBe(false)
    expect(body).not.toHaveProperty('accessToken')
    expect(body).not.toHaveProperty('connectionType')
  })

  it('lets an OAuth connection drop to click ids only without reconnecting', async () => {
    const fetchMock = toggleFetchMock('oauth')
    vi.stubGlobal('fetch', fetchMock)

    renderCard()

    const toggle = await screen.findByRole('switch')
    expect(toggle).not.toHaveAttribute('aria-disabled', 'true')
    expect(toggle).not.toBeDisabled()

    await userEvent.click(toggle)
    await userEvent.click(await screen.findByRole('button', { name: /confirmar/i }))

    await waitFor(() => expect(findPut(fetchMock)).toBeDefined())

    const body = JSON.parse((findPut(fetchMock)?.[1] as RequestInit).body as string)
    expect(body.advancedMatchingEnabled).toBe(false)
    expect(body).not.toHaveProperty('accessToken')
    expect(body).not.toHaveProperty('connectionType')
  })
})
