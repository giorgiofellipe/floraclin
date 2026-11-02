import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, within, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@/tests/test-utils'
import { toWaMeUrl } from '@/lib/phone'
import type { Patient } from '@/db/queries/patients'
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
