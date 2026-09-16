import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@/tests/test-utils'

const TEMPLATE_ID = '33333333-3333-4333-8333-333333333333'
const CONTRACT_ID = '44444444-4444-4444-8444-444444444444'

const templates = {
  botox: [{ id: TEMPLATE_ID, type: 'botox', title: 'Termo Botox', content: 'Riscos...', version: 2, isActive: true }],
  service_contract: [
    { id: CONTRACT_ID, type: 'service_contract', title: 'Contrato', content: 'Contrato de {{paciente}}', version: 1, isActive: true },
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
vi.mock('@/lib/contract-interpolation', () => ({
  interpolateContract: (content: string) => `RENDERED:${content}`,
  buildContractData: () => ({}),
}))
vi.mock('@/components/consent/consent-history', () => ({
  ConsentHistory: () => null,
}))
vi.mock('@/components/consent/consent-viewer', () => ({
  ConsentViewer: () => <div data-testid="local-viewer" />,
}))

const sendLinkProps = vi.fn()
vi.mock('@/components/procedures/approval/send-consent-signing-link', () => ({
  SendConsentSigningLink: (props: Record<string, unknown>) => {
    sendLinkProps(props)
    return <div data-testid="send-link" />
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

async function openAndPick(id: string) {
  fireEvent.click(screen.getByRole('button', { name: /novo termo/i }))
  fireEvent.change(await screen.findByTestId('template-select'), { target: { value: id } })
  await screen.findByRole('radiogroup', { name: /forma de assinatura/i })
}

beforeEach(() => {
  sendLinkProps.mockClear()
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
  it('signs on this device by default', async () => {
    renderWithProviders(<PatientConsentTab patientId="p1" patientName="Maria Silva" patientPhone="11999990000" />)
    await openAndPick(TEMPLATE_ID)

    expect(screen.getByTestId('local-viewer')).toBeInTheDocument()
    expect(screen.queryByTestId('send-link')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /assinar neste dispositivo/i })).toHaveAttribute('aria-checked', 'true')
  })

  it('sends the selected template as a signing link without a procedure', async () => {
    renderWithProviders(
      <PatientConsentTab patientId="p1" patientName="Maria Silva" patientPhone="11999990000" whatsappApiEnabled />,
    )
    await openAndPick(TEMPLATE_ID)
    fireEvent.click(screen.getByRole('radio', { name: /enviar por whatsapp/i }))

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

  it('renders a service contract the same way the local viewer would', async () => {
    renderWithProviders(<PatientConsentTab patientId="p1" patientName="Maria Silva" patientCpf="123" />)
    await openAndPick(CONTRACT_ID)
    fireEvent.click(screen.getByRole('radio', { name: /enviar por whatsapp/i }))

    await waitFor(() =>
      expect(sendLinkProps).toHaveBeenLastCalledWith(
        expect.objectContaining({
          consentTemplateIds: [CONTRACT_ID],
          renderedContents: { [CONTRACT_ID]: 'RENDERED:Contrato de {{paciente}}' },
        }),
      ),
    )
  })
})
