import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WhatsAppAutomations } from '../whatsapp-automations'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const SYSTEM_TEMPLATE = {
  id: 'sys-1',
  name: 'clinica_floraclin_confirm_appointment',
  status: 'APPROVED',
  purposeKey: 'appointment_confirmation',
}

const AUTOMATION = {
  id: 'auto-1',
  trigger: 'appointment_confirmation',
  enabled: true,
  templateId: null,
  config: {},
}

function mockFetch(handlers: Record<string, unknown>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const key = init?.method ? `${init.method} ${url}` : url
    const body = handlers[key]
    if (body === undefined) throw new Error(`unexpected fetch: ${key}`)
    return { ok: true, json: async () => body } as Response
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WhatsAppAutomations in FloraClin mode', () => {
  it('reads the platform-managed templates instead of the tenant ones', async () => {
    const fetchMock = mockFetch({
      '/api/whatsapp/automations': { data: [AUTOMATION] },
      '/api/whatsapp/templates/system': { data: [SYSTEM_TEMPLATE] },
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WhatsAppAutomations mode="floraclin" />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/whatsapp/templates/system')
    })
    expect(fetchMock).not.toHaveBeenCalledWith('/api/whatsapp/templates')
  })

  it('warns instead of claiming a default is in place when no platform template is approved', async () => {
    const fetchMock = mockFetch({
      '/api/whatsapp/automations': { data: [AUTOMATION] },
      '/api/whatsapp/templates/system': { data: [{ ...SYSTEM_TEMPLATE, status: 'REJECTED' }] },
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WhatsAppAutomations mode="floraclin" />)

    expect(await screen.findByText(/Mensagem indisponível no momento/)).toBeInTheDocument()
    expect(screen.queryByText('Mensagem padrão do FloraClin')).not.toBeInTheDocument()
    // The provision button must never appear on the shared number.
    expect(screen.queryByRole('button', { name: /criar template padrão/i })).not.toBeInTheDocument()
  })

  it('warns when the platform template is missing entirely', async () => {
    const fetchMock = mockFetch({
      '/api/whatsapp/automations': { data: [AUTOMATION] },
      '/api/whatsapp/templates/system': { data: [] },
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WhatsAppAutomations mode="floraclin" />)

    expect(await screen.findByText(/Mensagem indisponível no momento/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /criar template padrão/i })).not.toBeInTheDocument()
  })

  it('never sends a system template id when saving — the PATCH validates ids against the tenant', async () => {
    const fetchMock = mockFetch({
      '/api/whatsapp/automations': { data: [AUTOMATION] },
      '/api/whatsapp/templates/system': { data: [SYSTEM_TEMPLATE] },
      'PATCH /api/whatsapp/automations/appointment_confirmation': {
        data: { ...AUTOMATION, enabled: false },
      },
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WhatsAppAutomations mode="floraclin" />)

    // First trigger in the panel is appointment_confirmation.
    const [toggle] = await screen.findAllByRole('switch')
    await userEvent.click(toggle)
    await userEvent.click(screen.getByRole('button', { name: /salvar automações/i }))

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      )
      expect(patch).toBeDefined()
      const payload = JSON.parse((patch![1] as RequestInit).body as string)
      expect(payload.templateId).toBeNull()
    })
  })
})

describe('WhatsAppAutomations in own-number mode', () => {
  it('reads the tenant templates and forwards the matching template id', async () => {
    const ownTemplate = { ...SYSTEM_TEMPLATE, id: 'own-1' }
    const fetchMock = mockFetch({
      '/api/whatsapp/automations': { data: [AUTOMATION] },
      '/api/whatsapp/templates': { data: [ownTemplate] },
      'PATCH /api/whatsapp/automations/appointment_confirmation': {
        data: { ...AUTOMATION, enabled: false },
      },
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WhatsAppAutomations mode="own" />)

    // First trigger in the panel is appointment_confirmation.
    const [toggle] = await screen.findAllByRole('switch')
    await userEvent.click(toggle)
    await userEvent.click(screen.getByRole('button', { name: /salvar automações/i }))

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      )
      expect(patch).toBeDefined()
      const payload = JSON.parse((patch![1] as RequestInit).body as string)
      expect(payload.templateId).toBe('own-1')
    })
  })
})

describe('WhatsAppAutomations pending-template polling', () => {
  const PENDING = { ...SYSTEM_TEMPLATE, status: 'PENDING' }

  afterEach(() => {
    vi.useRealTimers()
  })

  function templateCalls(fetchMock: ReturnType<typeof vi.fn>) {
    return fetchMock.mock.calls.filter(([url]) => url === '/api/whatsapp/templates').length
  }

  it('re-reads the templates while one is PENDING and stops after three checks', async () => {
    vi.useFakeTimers()
    const fetchMock = mockFetch({
      '/api/whatsapp/automations': { data: [AUTOMATION] },
      '/api/whatsapp/templates': { data: [PENDING] },
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WhatsAppAutomations mode="own" />)
    await act(async () => {})
    expect(templateCalls(fetchMock)).toBe(1)

    for (const expected of [2, 3, 4]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000)
      })
      expect(templateCalls(fetchMock)).toBe(expected)
    }

    // Cap reached: further waiting must not add requests.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(templateCalls(fetchMock)).toBe(4)
  })

  it('stops polling as soon as the template comes back approved', async () => {
    vi.useFakeTimers()
    let body: { data: unknown[] } = { data: [PENDING] }
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/whatsapp/automations') {
        return { ok: true, json: async () => ({ data: [AUTOMATION] }) } as Response
      }
      return { ok: true, json: async () => body } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WhatsAppAutomations mode="own" />)
    await act(async () => {})

    body = { data: [SYSTEM_TEMPLATE] }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(templateCalls(fetchMock)).toBe(2)
    expect(screen.getByText('Template aprovado')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(templateCalls(fetchMock)).toBe(2)
  })
})
