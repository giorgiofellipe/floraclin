import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WhatsAppSettingsForm } from '../whatsapp-settings-form'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../whatsapp-credit-history', () => ({ WhatsAppCreditHistory: () => null }))

const BILLING = {
  subscription: { status: 'active', currentPeriodEnd: '2027-01-01T03:00:00.000Z' },
  plan: { name: 'Pro', slug: 'pro', features: { own_whatsapp_number: true } },
  usage: { whatsapp: { used: 0, limit: 300, periodEnd: '2026-12-01T03:00:00.000Z' } },
}

function stubFetch() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/billing/usage') return Response.json(BILLING)
    if (url === '/api/tenant' && init?.method === 'PUT') return Response.json({ success: true })
    if (url === '/api/whatsapp/automations') return Response.json({ data: [] })
    if (url === '/api/procedure-types') return Response.json([])
    return Response.json({ data: [] })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function tenantPuts(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls
    .filter(([url, init]) => url === '/api/tenant' && init?.method === 'PUT')
    .map(([, init]) => JSON.parse(init!.body as string).settings)
}

function renderForm(settings: Record<string, unknown> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <WhatsAppSettingsForm initialSettings={settings} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WhatsAppSettingsForm', () => {
  // Several sheet steps: give it room when the full suite saturates the CPU.
  it('connects an own number through the guided sheet, saving the mode with the credentials in one write', { timeout: 15_000 }, async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch()
    renderForm({ whatsapp_allowed_roles: ['owner', 'receptionist'] })

    await user.click(screen.getByRole('button', { name: 'Avançado' }))
    await user.click(await screen.findByRole('button', { name: /conectar número próprio/i }))
    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    const next = screen.getByRole('button', { name: 'Continuar' })
    expect(next).toBeDisabled()
    await user.click(screen.getByLabelText('ID do número de telefone'))
    await user.paste('123456789012345')
    await user.click(screen.getByLabelText('ID da conta comercial do WhatsApp'))
    await user.paste('987654321098765')
    await user.click(screen.getByLabelText('Token de acesso'))
    await user.paste('EAAG-token')
    await user.click(next)

    expect(screen.getByLabelText('Token de verificação')).toHaveValue('floraclin_webhook_verify')
    await user.click(screen.getByRole('button', { name: 'Conectar número' }))

    await waitFor(() => expect(tenantPuts(fetchMock)).toHaveLength(1))
    expect(tenantPuts(fetchMock)[0]).toEqual({
      whatsapp_mode: 'own',
      whatsapp_enabled: true,
      whatsapp_phone_number_id: '123456789012345',
      whatsapp_business_account_id: '987654321098765',
      whatsapp_access_token: 'EAAG-token',
    })
    expect(await screen.findByText('Conectado ao número de ID 123456789012345.')).toBeInTheDocument()
  })

  it('edits a connected number without asking for the token again, since GET /api/tenant never returns it', { timeout: 15_000 }, async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch()
    renderForm({
      whatsapp_mode: 'own',
      whatsapp_phone_number_id: '111',
      whatsapp_business_account_id: '222',
      whatsapp_allowed_roles: ['owner'],
    })

    await user.click(await screen.findByRole('button', { name: 'Editar conexão' }))
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    await user.clear(screen.getByLabelText('ID da conta comercial do WhatsApp'))
    await user.click(screen.getByLabelText('ID da conta comercial do WhatsApp'))
    await user.paste('333')
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    await user.click(screen.getByRole('button', { name: 'Conectar número' }))

    await waitFor(() => expect(tenantPuts(fetchMock)).toHaveLength(1))
    expect(tenantPuts(fetchMock)[0]).toMatchObject({ whatsapp_mode: 'own', whatsapp_business_account_id: '333' })
    expect(tenantPuts(fetchMock)[0]).not.toHaveProperty('whatsapp_access_token')
  })

  it('saves a role change by sending only the roles', async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch()
    renderForm({ whatsapp_allowed_roles: ['owner'] })

    expect(screen.getByRole('checkbox', { name: /Proprietário/ })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('checkbox', { name: /Financeiro/ }))

    await waitFor(() => expect(tenantPuts(fetchMock)).toHaveLength(1))
    // Only the roles: resending mode or credentials could overwrite a connection saved from another tab.
    expect(tenantPuts(fetchMock)[0]).toEqual({ whatsapp_allowed_roles: ['owner', 'financial'] })
  })

  it('asks before moving sends off the own number, and only then saves the mode alone', async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch()
    renderForm({ whatsapp_mode: 'own', whatsapp_phone_number_id: '111', whatsapp_allowed_roles: ['owner'] })

    await user.click(screen.getByRole('button', { name: 'Avançado' }))
    await user.click(await screen.findByRole('button', { name: 'Voltar para o número do FloraClin' }))
    expect(tenantPuts(fetchMock)).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Usar o número do FloraClin' }))

    await waitFor(() => expect(tenantPuts(fetchMock)).toEqual([{ whatsapp_mode: 'floraclin' }]))
  })
})
