import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EmitNfseDialog } from '../emit-nfse-dialog'

const BLANK_TAKER = { cpf: '', zip: '', street: '', number: '', complement: '', neighborhood: '', city: '', state: '' }

function mockPreview(competenceIsPastMonth: boolean, patient: Record<string, unknown> = {}) {
  const preview = {
    patients: [
      {
        patientId: 'p1',
        patientName: 'Maria',
        paymentRecordIds: ['pay-1'],
        total: 500,
        missing: [],
        addressSource: 'patient',
        email: 'maria@example.com',
        canEditTaker: true,
        current: null,
        ...patient,
      },
    ],
    defaultCompetence: '2026-09-30',
    competenceIsPastMonth,
    settings: { emailPatient: true },
  }
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => ({
    ok: true,
    json: async () => ({ data: init?.method === 'POST' ? [] : preview }),
  }) as Response)
}

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <EmitNfseDialog paymentRecordIds={['pay-1']} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  )
}

describe('EmitNfseDialog', () => {
  afterEach(() => vi.restoreAllMocks())

  it('offers the service date and today when the competence is a past month, showing the service day unshifted', async () => {
    mockPreview(true)
    renderDialog()

    expect(await screen.findByText('Data do serviço (30/09/2026)')).toBeInTheDocument()
    expect(screen.getByText(/^Hoje \(/)).toBeInTheDocument()
  })

  it('hides the competence choice when the service is in the current month', async () => {
    mockPreview(false)
    renderDialog()

    await screen.findByText('Maria: R$ 500,00')
    expect(screen.queryByText(/^Data do serviço/)).not.toBeInTheDocument()
  })

  it('asks only for the CPF when the clinic address stands in, and sends the taker without an address', async () => {
    const fetchMock = mockPreview(false, { missing: ['cpf'], addressSource: 'clinic', current: BLANK_TAKER })
    renderDialog()

    expect(await screen.findByText('Paciente sem endereço cadastrado: a nota usa o endereço da clínica.')).toBeInTheDocument()
    expect(screen.queryByText('CEP')).not.toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox'), '39053344705')
    await userEvent.click(screen.getByRole('button', { name: 'Emitir' }))

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body)).takers).toEqual([{ patientId: 'p1', cpf: '390.533.447-05' }])
  })

  it('tells a role that cannot edit the patient to ask only for the CPF when the clinic address stands in', async () => {
    mockPreview(false, { missing: ['cpf'], addressSource: 'clinic', canEditTaker: false })
    renderDialog()

    expect(await screen.findByText('Peça a quem tem acesso ao cadastro para completar o CPF.')).toBeInTheDocument()
    expect(screen.queryByText(/completar CPF e endereço/)).not.toBeInTheDocument()
  })
})
