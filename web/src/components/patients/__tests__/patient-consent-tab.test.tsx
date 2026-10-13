import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@/tests/test-utils'

const TEMPLATE_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_ID = '55555555-5555-4555-8555-555555555555'
const CONTRACT_ID = '44444444-4444-4444-8444-444444444444'

const templates = {
  botox: [
    { id: TEMPLATE_ID, type: 'botox', title: 'Termo Botox', content: 'Riscos...', version: 2, isActive: true },
    { id: OTHER_ID, type: 'botox', title: 'Termo Botox antigo', content: 'Riscos v1', version: 1, isActive: true },
  ],
  service_contract: [
    { id: CONTRACT_ID, type: 'service_contract', title: 'Contrato', content: 'Contrato de {{nome_paciente}}', version: 1, isActive: true },
  ],
}

vi.mock('@/hooks/queries/use-consent', () => ({
  useConsentTemplates: () => ({ data: templates, isLoading: false }),
}))
vi.mock('@/hooks/queries/use-tenant', () => ({
  useTenant: () => ({ data: { name: 'Clínica Teste' } }),
}))
vi.mock('@/hooks/queries/use-profile', () => ({
  useProfile: () => ({ data: { data: { fullName: 'Dra. Ana' } } }),
}))

const renderServiceContract = vi.fn((content: string, _context: unknown) => `RENDERED:${content}`)
vi.mock('@/lib/contract-interpolation', () => ({
  renderServiceContract: (...args: [string, unknown]) => renderServiceContract(...args),
}))
vi.mock('@/components/consent/consent-history', () => ({
  ConsentHistory: () => null,
}))
vi.mock('@/components/consent/consent-viewer', () => ({
  ConsentViewer: () => <div data-testid="local-viewer" />,
}))

const sendLinkProps = vi.fn()
vi.mock('@/components/procedures/approval/send-consent-signing-link', () => ({
  // Each mount gets its own id, so a remount is observable from outside.
  SendConsentSigningLink: (props: Record<string, unknown>) => {
    const [instance] = useState(() => Math.random().toString(36).slice(2))
    sendLinkProps(props)
    return <div data-testid="send-link" data-instance={instance} />
  },
}))

// The base-ui Select is not drivable from jsdom; a native select keeps the
// tab's own wiring under test.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    items,
    value,
    onValueChange,
  }: {
    items: Record<string, string>
    value: string
    onValueChange: (v: string | null) => void
  }) => (
    <select data-testid="template-select" value={value} onChange={(e) => onValueChange(e.target.value || null)}>
      <option value="">--</option>
      {Object.entries(items).map(([id, label]) => (
        <option key={id} value={id}>
          {label}
        </option>
      ))}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: () => null,
}))

import { PatientConsentTab } from '../patient-consent-tab'

function templateById(id: string) {
  return Object.values(templates).flat().find((t) => t.id === id)
}

async function pick(id: string) {
  fireEvent.change(await screen.findByTestId('template-select'), { target: { value: id } })
  await screen.findByRole('group', { name: /forma de assinatura/i })
}

async function openAndPick(id: string) {
  fireEvent.click(screen.getByRole('button', { name: /novo termo/i }))
  await pick(id)
}

beforeEach(() => {
  sendLinkProps.mockClear()
  renderServiceContract.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const id = url.split('/').pop()!
      return { ok: true, json: async () => templateById(id) }
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PatientConsentTab', () => {
  it('sends by WhatsApp by default when the patient has a phone', async () => {
    renderWithProviders(<PatientConsentTab patientId="p1" patientName="Maria Silva" patientPhone="11999990000" />)
    await openAndPick(TEMPLATE_ID)

    expect(screen.getByTestId('send-link')).toBeInTheDocument()
    expect(screen.queryByTestId('local-viewer')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /enviar por whatsapp/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches to signing on this device', async () => {
    renderWithProviders(<PatientConsentTab patientId="p1" patientName="Maria Silva" patientPhone="11999990000" />)
    await openAndPick(TEMPLATE_ID)
    fireEvent.click(screen.getByRole('button', { name: /assinar neste dispositivo/i }))

    expect(screen.getByTestId('local-viewer')).toBeInTheDocument()
    expect(screen.queryByTestId('send-link')).not.toBeInTheDocument()
  })

  it('sends the selected template as a signing link without a procedure', async () => {
    renderWithProviders(
      <PatientConsentTab patientId="p1" patientName="Maria Silva" patientPhone="11999990000" whatsappApiEnabled />,
    )
    await openAndPick(TEMPLATE_ID)

    await waitFor(() => expect(screen.getByTestId('send-link')).toBeInTheDocument())
    expect(screen.queryByTestId('local-viewer')).not.toBeInTheDocument()
    expect(sendLinkProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        patientId: 'p1',
        patientName: 'Maria Silva',
        patientPhone: '11999990000',
        consentTemplateIds: [TEMPLATE_ID],
        whatsappApiEnabled: true,
        renderedContents: undefined,
      }),
    )
    expect(sendLinkProps.mock.lastCall?.[0]).not.toHaveProperty('procedureRecordId')
  })

  it('remounts the link sender when the template changes, so a generated link cannot outlive its template', async () => {
    renderWithProviders(<PatientConsentTab patientId="p1" patientName="Maria Silva" patientPhone="11999990000" />)
    await openAndPick(TEMPLATE_ID)
    const first = (await screen.findByTestId('send-link')).getAttribute('data-instance')

    await pick(OTHER_ID)

    await waitFor(() => {
      const sender = screen.getByTestId('send-link')
      expect(sender.getAttribute('data-instance')).not.toBe(first)
    })
    expect(sendLinkProps).toHaveBeenLastCalledWith(expect.objectContaining({ consentTemplateIds: [OTHER_ID] }))
  })

  it('renders a service contract through the shared renderer with the clinic context', async () => {
    renderWithProviders(
      <PatientConsentTab patientId="p1" patientName="Maria Silva" patientCpf="123" patientPhone="11999990000" />,
    )
    await openAndPick(CONTRACT_ID)

    await waitFor(() =>
      expect(sendLinkProps).toHaveBeenLastCalledWith(
        expect.objectContaining({
          consentTemplateIds: [CONTRACT_ID],
          renderedContents: { [CONTRACT_ID]: 'RENDERED:Contrato de {{nome_paciente}}' },
        }),
      ),
    )
    expect(renderServiceContract).toHaveBeenCalledWith('Contrato de {{nome_paciente}}', {
      patientName: 'Maria Silva',
      patientCpf: '123',
      practitionerName: 'Dra. Ana',
      clinicName: 'Clínica Teste',
    })
  })

  it('falls back to device signing and disables the WhatsApp option when the patient has no phone', async () => {
    renderWithProviders(<PatientConsentTab patientId="p1" patientName="Maria Silva" patientPhone={null} />)
    await openAndPick(TEMPLATE_ID)

    expect(screen.getByTestId('local-viewer')).toBeInTheDocument()
    const remote = screen.getByRole('button', { name: /enviar por whatsapp/i })
    expect(remote).toBeDisabled()
    expect(remote).toHaveAttribute('title', 'Paciente sem telefone cadastrado')
  })

  it('returns to the default mode after the dialog closes', async () => {
    renderWithProviders(<PatientConsentTab patientId="p1" patientName="Maria Silva" patientPhone="11999990000" />)
    await openAndPick(TEMPLATE_ID)
    fireEvent.click(screen.getByRole('button', { name: /assinar neste dispositivo/i }))
    await screen.findByTestId('local-viewer')

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('template-select')).not.toBeInTheDocument())

    await openAndPick(TEMPLATE_ID)
    expect(screen.getByTestId('send-link')).toBeInTheDocument()
    expect(screen.queryByTestId('local-viewer')).not.toBeInTheDocument()
  })
})
