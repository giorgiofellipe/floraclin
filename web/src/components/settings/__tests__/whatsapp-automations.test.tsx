import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
