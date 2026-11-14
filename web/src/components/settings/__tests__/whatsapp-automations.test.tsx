import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WhatsAppAutomations as Automations } from '../whatsapp-automations'

function WhatsAppAutomations(props: React.ComponentProps<typeof Automations>) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Automations {...props} />
    </QueryClientProvider>
  )
}

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

  it('previews the message an automation sends, naming its variables next to a filled example', async () => {
    const fetchMock = mockFetch({
      '/api/whatsapp/automations': { data: [] },
      '/api/whatsapp/templates/system': {
        data: [{
          ...SYSTEM_TEMPLATE,
          components: [{ type: 'BODY', text: 'Olá, {{1}}! Sua consulta na {{2}} está confirmada.' }],
        }],
        clinicName: 'Clínica Lume',
      },
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WhatsAppAutomations mode="floraclin" />)

    await userEvent.click(await screen.findByRole('button', { name: /ver mensagem enviada/i }))

    expect(screen.getByText('Nome do paciente')).toBeInTheDocument()
    expect(screen.getByText('Nome da clínica')).toBeInTheDocument()
    expect(screen.getByText('Olá, Maria Silva! Sua consulta na Clínica Lume está confirmada.')).toBeInTheDocument()
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

  it('never sends a system template id when saving: the PATCH validates ids against the tenant', async () => {
    const fetchMock = mockFetch({
      '/api/whatsapp/automations': { data: [AUTOMATION] },
      '/api/whatsapp/templates/system': { data: [SYSTEM_TEMPLATE] },
      'PATCH /api/whatsapp/automations/appointment_confirmation': {
        data: { ...AUTOMATION, enabled: false },
      },
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WhatsAppAutomations mode="floraclin" />)

    await userEvent.click(await screen.findByRole('switch', { name: 'Confirmação de consulta' }))

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

    await userEvent.click(await screen.findByRole('switch', { name: 'Confirmação de consulta' }))

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

describe('WhatsAppAutomations autosave and guidance', () => {
  it('reverts the switch and says so when the save fails, instead of showing an automation that is off as on', async () => {
    const { toast } = await import('sonner')
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return { ok: false, json: async () => ({ error: 'Sem permissão' }) } as Response
      if (url === '/api/whatsapp/automations') return { ok: true, json: async () => ({ data: [] }) } as Response
      return { ok: true, json: async () => ({ data: [SYSTEM_TEMPLATE] }) } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WhatsAppAutomations mode="floraclin" />)

    const toggle = await screen.findByRole('switch', { name: 'Confirmação de consulta' })
    await userEvent.click(toggle)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Sem permissão')))
    expect(toggle).not.toBeChecked()
  })

  it('shows guidance instead of an empty section when the own number is not connected', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === '/api/whatsapp/automations'
        ? ({ ok: false, status: 400, json: async () => ({ error: 'WhatsApp not enabled' }) } as Response)
        : ({ ok: true, json: async () => ({ data: [] }) } as Response),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<WhatsAppAutomations mode="own" />)

    expect(await screen.findByText(/Conecte o número próprio para ativar/)).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('asks for the standard templates when own mode has none', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/api/whatsapp/automations': { data: [{ ...AUTOMATION, enabled: false }] },
      '/api/whatsapp/templates': { data: [] },
      '/api/procedure-types': [],
    }))

    render(<WhatsAppAutomations mode="own" />)

    expect(await screen.findByText(/Crie os templates padrão/)).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('keeps the switches when own mode has no templates but an automation is still on, so it can be turned off', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/api/whatsapp/automations': { data: [AUTOMATION] },
      '/api/whatsapp/templates': { data: [] },
      '/api/procedure-types': [],
    }))

    render(<WhatsAppAutomations mode="own" />)

    expect(await screen.findByText(/Crie os templates padrão/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Confirmação de consulta' })).toBeChecked()
  })

  it('shows the next send of an enabled daily automation and warns when no procedure has care text', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/api/whatsapp/automations': {
        data: [AUTOMATION, { ...AUTOMATION, id: 'auto-2', trigger: 'post_procedure_care' }],
      },
      '/api/whatsapp/templates/system': {
        data: [SYSTEM_TEMPLATE, { ...SYSTEM_TEMPLATE, id: 'sys-2', purposeKey: 'post_procedure_care' }],
      },
      '/api/procedure-types': [{ preProcedureInstructions: null, postProcedureCare: '  ' }],
    }))

    render(<WhatsAppAutomations mode="floraclin" />)

    expect(await screen.findByText(/Próximo envio: (hoje|amanhã) às 6h30/)).toBeInTheDocument()
    expect(await screen.findByText(/Nenhum procedimento tem cuidados pós-procedimento cadastrados/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cadastrar em Procedimentos' })).toHaveAttribute('href', '/configuracoes?tab=procedimentos')
  })
})
