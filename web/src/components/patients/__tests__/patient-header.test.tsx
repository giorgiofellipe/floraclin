import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, within, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@/tests/test-utils'
import { toWaMeUrl } from '@/lib/phone'
import type { Patient } from '@/db/queries/patients'
import { SubscriptionAccessProvider } from '@/components/layout/subscription-access'
import { PatientHeader } from '../patient-header'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const PATIENT_ID = '11111111-1111-4111-8111-111111111111'

function makePatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: PATIENT_ID,
    fullName: 'Maria da Silva',
    phone: '(11) 98765-4321',
    email: 'maria@example.com',
    cpf: '12345678901',
    birthDate: '1990-05-20',
    gender: 'female',
    ...overrides,
  } as Patient
}

const callbacks = {
  onNewAppointment: vi.fn(),
  onNewCharge: vi.fn(),
  onNewDocument: vi.fn(),
  onRequestDocuments: vi.fn(),
}

function renderHeader(
  props: Partial<React.ComponentProps<typeof PatientHeader>> = {},
) {
  renderWithProviders(
    <PatientHeader
      patient={makePatient()}
      role="practitioner"
      hasActiveService={false}
      {...callbacks}
      {...props}
    />,
  )
  return within(screen.getByTestId('patient-header-desktop'))
}

describe('PatientHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens the in-app WhatsApp conversation when the API is enabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { conversation: { id: 'conv-1' } } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const desktop = renderHeader({ whatsappApiEnabled: true })

    fireEvent.click(desktop.getByRole('button', { name: 'WhatsApp' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/whatsapp?conversa=conv-1'))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/whatsapp/conversations',
      expect.objectContaining({ body: JSON.stringify({ patientId: PATIENT_ID }) }),
    )
  })

  it('falls back to a wa.me link when the in-app API is off', () => {
    const desktop = renderHeader({ whatsappApiEnabled: false })

    const link = desktop.getByRole('link', { name: /WhatsApp/ })
    expect(link).toHaveAttribute('href', toWaMeUrl('(11) 98765-4321'))
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('renders no WhatsApp control for an invalid phone', () => {
    const desktop = renderHeader({
      patient: makePatient({ phone: '' }),
      whatsappApiEnabled: true,
    })

    expect(desktop.queryByRole('button', { name: 'WhatsApp' })).toBeNull()
    expect(desktop.queryByRole('link', { name: /WhatsApp/ })).toBeNull()
  })

  it('keeps every action of the old header', () => {
    const desktop = renderHeader({ whatsappApiEnabled: true })

    fireEvent.click(desktop.getByRole('button', { name: 'Novo Agendamento' }))
    fireEvent.click(desktop.getByRole('button', { name: 'Nova Cobrança' }))
    fireEvent.click(desktop.getByRole('button', { name: 'Novo Documento' }))
    expect(callbacks.onNewAppointment).toHaveBeenCalledOnce()
    expect(callbacks.onNewCharge).toHaveBeenCalledOnce()
    expect(callbacks.onNewDocument).toHaveBeenCalledOnce()

    expect(desktop.getByRole('link', { name: /Iniciar Atendimento/ })).toHaveAttribute(
      'href',
      `/pacientes/${PATIENT_ID}/atendimento`,
    )
    expect(screen.getByRole('link', { name: 'Voltar para lista' })).toHaveAttribute(
      'href',
      '/pacientes',
    )
    expect(desktop.getByRole('link', { name: 'maria@example.com' })).toHaveAttribute(
      'href',
      'mailto:maria@example.com',
    )
    expect(desktop.getByText('***.456.***-**')).toBeInTheDocument()
  })

  it('shows Continuar Atendimento when a service is active', () => {
    const desktop = renderHeader({ hasActiveService: true })

    expect(desktop.getByRole('link', { name: /Continuar Atendimento/ })).toBeInTheDocument()
  })

  it('offers Ligar and Solicitar documentos from the phone popover', async () => {
    const desktop = renderHeader({ whatsappApiEnabled: true })

    fireEvent.click(desktop.getByText('(11) 98765-4321'))

    expect(await screen.findByRole('link', { name: 'Ligar' })).toHaveAttribute(
      'href',
      'tel:+5511987654321',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar documentos' }))
    expect(callbacks.onRequestDocuments).toHaveBeenCalledOnce()
  })

  it('links Novo diagrama only for roles that can write diagrams', () => {
    const { unmount } = renderWithProviders(
      <PatientHeader patient={makePatient()} role="practitioner" hasActiveService={false} {...callbacks} />,
    )
    const practitioner = within(screen.getByTestId('patient-header-desktop'))
    expect(practitioner.getByRole('link', { name: /Novo diagrama/ })).toHaveAttribute(
      'href',
      `/pacientes/${PATIENT_ID}/diagramas/novo`,
    )
    unmount()

    const receptionist = renderHeader({ role: 'receptionist' })
    expect(receptionist.queryByRole('link', { name: /Novo diagrama/ })).toBeNull()
  })
})

describe('PatientHeader phone Mais menu', () => {
  async function openMais(
    props: Partial<React.ComponentProps<typeof PatientHeader>> = {},
    { readOnly = false } = {},
  ) {
    renderWithProviders(
      <SubscriptionAccessProvider readOnly={readOnly} reason={readOnly ? 'trial' : null} tenantId="t1" canSubscribe plans={[]}>
        <PatientHeader
          patient={makePatient()}
          role="practitioner"
          hasActiveService={false}
          {...callbacks}
          {...props}
        />
      </SubscriptionAccessProvider>,
    )
    const mobile = within(screen.getByTestId('patient-header-mobile'))
    fireEvent.click(mobile.getByRole('button', { name: 'Mais' }))
    await screen.findByRole('menuitem', { name: /Novo documento/ })
  }

  it('lists the secondary actions with Email when the patient has one', async () => {
    await openMais()

    expect(screen.getByRole('menuitem', { name: /Novo diagrama/ })).toHaveAttribute(
      'href',
      `/pacientes/${PATIENT_ID}/diagramas/novo`,
    )
    expect(screen.getByRole('menuitem', { name: /Ligar/ })).toHaveAttribute('href', 'tel:+5511987654321')
    expect(screen.getByRole('menuitem', { name: /Abrir no WhatsApp Web/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Email/ })).toHaveAttribute(
      'href',
      'mailto:maria@example.com',
    )
  })

  it('hides Novo diagrama for a receptionist and Email for a patient without one', async () => {
    await openMais({ role: 'receptionist', patient: makePatient({ email: null }) })

    expect(screen.queryByRole('menuitem', { name: /Novo diagrama/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Email/ })).toBeNull()
  })

  it('hides Novo diagrama while the subscription is read-only', async () => {
    await openMais({}, { readOnly: true })

    expect(screen.queryByRole('menuitem', { name: /Novo diagrama/ })).toBeNull()
  })

  it('guards Agendar and Cobrar on the phone like their desktop buttons when read-only', async () => {
    await openMais({}, { readOnly: true })
    const desktop = within(screen.getByTestId('patient-header-desktop'))
    const mobile = within(screen.getByTestId('patient-header-mobile'))
    const guardOf = (scope: typeof mobile, name: string) =>
      scope.getAllByRole('button', { name })[0].getAttribute('aria-disabled')

    expect(guardOf(mobile, 'Agendar')).toBe('true')
    expect(guardOf(mobile, 'Agendar')).toBe(guardOf(desktop, 'Novo Agendamento'))
    expect(guardOf(mobile, 'Cobrar')).toBe(guardOf(desktop, 'Nova Cobrança'))
  })

  it('opens the document flow from Novo documento', async () => {
    await openMais()

    fireEvent.click(screen.getByRole('menuitem', { name: /Novo documento/ }))

    expect(callbacks.onNewDocument).toHaveBeenCalledOnce()
  })
})
