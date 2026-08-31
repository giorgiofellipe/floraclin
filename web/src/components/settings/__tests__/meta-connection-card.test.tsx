import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import { MetaConnectionCard } from '../meta-connection-card'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const BASE_CONNECTION: {
  id: string
  datasetId: string | null
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
        return new Response(JSON.stringify({ ok: true, eventsReceived: 1 }), { status: 200 })
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

  function testFetchMock(testBody: unknown, status = 200) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify(testBody), { status })
      }
      return new Response(JSON.stringify({ data: BASE_CONNECTION, events: [] }), { status: 200 })
    })
  }

  // The route answers 200 with Meta's verdict inside the body, so an HTTP 200
  // is not by itself a working connection.
  it("shows Meta's message and never claims success when Meta rejects the event", async () => {
    vi.stubGlobal(
      'fetch',
      testFetchMock({
        ok: false,
        kind: 'invalid',
        message: 'O campo user_data precisa de ao menos um identificador.',
        errorUserTitle: 'Parâmetro inválido',
        fbTraceId: 'A3ip2Ls_KK6lBhQHO3k079_',
      }),
    )

    renderCard()

    await userEvent.click(await screen.findByRole('button', { name: /testar conexão/i }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('O campo user_data precisa de ao menos um identificador.'),
      ),
    )
    expect(toast.success).not.toHaveBeenCalled()

    expect(await screen.findByText('Parâmetro inválido')).toBeInTheDocument()
    expect(screen.getByText(/A3ip2Ls_KK6lBhQHO3k079_/)).toBeInTheDocument()
  })

  it('reports a route-level refusal instead of a success', async () => {
    vi.stubGlobal('fetch', testFetchMock({ error: 'Nenhuma conexão configurada.' }, 404))

    renderCard()

    await userEvent.click(await screen.findByRole('button', { name: /testar conexão/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Nenhuma conexão configurada.'))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('reports a success when Meta accepts the event', async () => {
    vi.stubGlobal('fetch', testFetchMock({ ok: true, eventsReceived: 1, fbTraceId: 'trace-ok' }))

    renderCard()

    await userEvent.click(await screen.findByRole('button', { name: /testar conexão/i }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Conexão testada com sucesso'))
    expect(toast.error).not.toHaveBeenCalled()
    expect(await screen.findByText('A Meta recebeu o evento de teste.')).toBeInTheDocument()
  })
})

describe('MetaConnectionCard: test event code on an active connection', () => {
  function codeFetchMock(stored: string | null) {
    const connection = { ...BASE_CONNECTION, connectionType: 'oauth' as const, testEventCode: stored }
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ data: connection }), { status: 200 })
      }
      return new Response(JSON.stringify({ data: connection, events: [] }), { status: 200 })
    })
  }

  it('offers the test event code field on an active connection and pre-fills the stored code', async () => {
    vi.stubGlobal('fetch', codeFetchMock('TEST12345'))

    renderCard()

    const input = await screen.findByLabelText(/código de evento de teste/i)
    expect(input).toHaveValue('TEST12345')
    expect(screen.getByText(/testar eventos/i)).toBeInTheDocument()
  })

  it('saves a typed code on an active connection without asking for an access token', async () => {
    const fetchMock = codeFetchMock(null)
    vi.stubGlobal('fetch', fetchMock)

    renderCard()

    const input = await screen.findByLabelText(/código de evento de teste/i)
    await userEvent.type(input, 'TEST999')
    await userEvent.click(screen.getByRole('button', { name: /salvar código/i }))

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'PUT')).toBe(true),
    )

    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT')
    const body = JSON.parse((put?.[1] as RequestInit).body as string)
    expect(body.testEventCode).toBe('TEST999')
    expect(body.datasetId).toBe('dataset-1')
    expect(body).not.toHaveProperty('accessToken')
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

describe('MetaConnectionCard: leg 2 of the OAuth flow', () => {
  const PENDING = { ...BASE_CONNECTION, status: 'pending_dataset', datasetId: null, connectionType: 'oauth' as const }

  function legTwoFetchMock() {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/businesses')) {
        return new Response(JSON.stringify({ data: [{ id: 'biz-1', name: 'Portfólio da Clínica' }] }), {
          status: 200,
        })
      }
      if (url.includes('/datasets')) {
        return new Response(JSON.stringify({ data: [{ id: 'pixel-1', name: 'Pixel Principal' }] }), {
          status: 200,
        })
      }
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ data: { ...PENDING, status: 'active', datasetId: 'pixel-1' } }), {
          status: 200,
        })
      }
      return new Response(JSON.stringify({ data: PENDING, events: [] }), { status: 200 })
    })
  }

  it('renders the dataset picker instead of the connect button', async () => {
    vi.stubGlobal('fetch', legTwoFetchMock())

    renderCard()

    expect(await screen.findByText('Conexão autorizada. Escolha o conjunto de dados.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /conectar meta/i })).not.toBeInTheDocument()
    expect(await screen.findByLabelText(/portfólio empresarial/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/conjunto de dados/i)).toBeInTheDocument()
  })

  it('lists the portfolios, then the datasets in the chosen one, then saves the pick', async () => {
    const fetchMock = legTwoFetchMock()
    vi.stubGlobal('fetch', fetchMock)

    renderCard()

    const businessSelect = await screen.findByLabelText(/portfólio empresarial/i)
    await waitFor(() => expect(screen.getByRole('option', { name: /Portfólio da Clínica/ })).toBeInTheDocument())

    await userEvent.selectOptions(businessSelect, 'biz-1')

    const datasetSelect = await screen.findByLabelText(/conjunto de dados/i)
    await waitFor(() => expect(screen.getByRole('option', { name: /Pixel Principal/ })).toBeInTheDocument())

    await userEvent.selectOptions(datasetSelect, 'pixel-1')
    await userEvent.click(screen.getByRole('button', { name: /salvar conjunto de dados/i }))

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'PUT')).toBe(true),
    )

    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT')
    const body = JSON.parse((put?.[1] as RequestInit).body as string)
    expect(body).toEqual({ datasetId: 'pixel-1' })
  })

  // A capped list that looks complete would send the owner hunting for a
  // portfolio the picker silently dropped.
  it('warns that the portfolio list was cut when the route says it was truncated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/businesses')) {
          return new Response(
            JSON.stringify({ data: [{ id: 'biz-1', name: 'Portfólio da Clínica' }], truncated: true }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ data: PENDING, events: [] }), { status: 200 })
      }),
    )

    renderCard()

    expect(await screen.findByText(/lista foi cortada/i)).toBeInTheDocument()
  })
})
