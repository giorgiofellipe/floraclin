import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { WhatsAppSystemTemplates } from '../whatsapp-system-templates'
import { TEMPLATE_BLUEPRINTS } from '@/lib/whatsapp-blueprints'

const CONFIRMATION = TEMPLATE_BLUEPRINTS.find(
  (b) => b.purposeKey === 'appointment_confirmation',
)!

function stubFetch(body: unknown) {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => body }) as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WhatsAppSystemTemplates', () => {
  it('shows the message with the clinic name and example values, not raw placeholders', async () => {
    stubFetch({
      clinicName: 'Dra. Micaela Floriani',
      data: [
        {
          id: 'sys-1',
          name: 'clinica_floraclin_confirm_appointment',
          purposeKey: 'appointment_confirmation',
          components: CONFIRMATION.components,
          variableMapping: CONFIRMATION.variables,
        },
      ],
    })

    render(<WhatsAppSystemTemplates />)

    const body = await screen.findByText(/Gostaríamos de confirmar/)
    expect(body.textContent).toContain('Dra. Micaela Floriani')
    expect(body.textContent).toContain('Maria Silva')
    expect(body.textContent).not.toContain('{{')

    expect(screen.getByText('Confirmar')).toBeInTheDocument()
    expect(screen.getByText('Reagendar')).toBeInTheDocument()
    expect(screen.getByText('Confirmação de consulta')).toBeInTheDocument()
  })

  it('renders nothing when there are no system templates', async () => {
    stubFetch({ clinicName: 'Clínica Flora', data: [] })

    const { container } = render(<WhatsAppSystemTemplates />)

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement()
    })
  })
})
