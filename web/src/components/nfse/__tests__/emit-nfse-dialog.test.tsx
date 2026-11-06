import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EmitNfseDialog } from '../emit-nfse-dialog'

const BLANK_TAKER = { cpf: '', zip: '', street: '', number: '', complement: '', neighborhood: '', city: '', state: '' }

const ISSUED = {
  id: 'doc-1',
  status: 'issued',
  paymentRecordId: 'pay-1',
  nfseNumber: '12',
  patientName: 'Maria',
  value: 500,
  email: 'maria@example.com',
  emailRequested: true,
  emailSent: true,
}

function mockPreview(
  competenceIsPastMonth: boolean,
  patient: Record<string, unknown> = {},
  emitted: Record<string, unknown>[][] = [[]],
) {
  let posts = 0
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
    json: async () => ({ data: init?.method === 'POST' ? emitted[Math.min(posts++, emitted.length - 1)] : preview }),
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

function postedBodies(fetchMock: ReturnType<typeof mockPreview>) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body)))
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
    await userEvent.type(screen.getByLabelText('CPF'), '39053344705')
    await userEvent.click(screen.getByRole('button', { name: 'Emitir' }))

    expect(postedBodies(fetchMock)[0].takers).toEqual([{ patientId: 'p1', cpf: '390.533.447-05' }])
  })

  it('tells a role that cannot edit the patient to ask only for the CPF when the clinic address stands in', async () => {
    mockPreview(false, { missing: ['cpf'], addressSource: 'clinic', canEditTaker: false })
    renderDialog()

    expect(await screen.findByText('Peça a quem tem acesso ao cadastro para completar o CPF.')).toBeInTheDocument()
    expect(screen.queryByText(/completar CPF e endereço/)).not.toBeInTheDocument()
    expect(screen.queryByText('Preencher endereço do paciente')).not.toBeInTheDocument()
  })

  it("sends the patient's own address when the user fills it instead of using the clinic's", async () => {
    const fetchMock = mockPreview(false, { addressSource: 'clinic', current: { ...BLANK_TAKER, cpf: '390.533.447-05' } })
    renderDialog()

    await userEvent.click(await screen.findByText('Preencher endereço do paciente'))
    expect(screen.queryByText(/a nota usa o endereço da clínica/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Emitir' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('CEP'), '88220000')
    await userEvent.type(screen.getByLabelText('Rua'), 'Rua A')
    await userEvent.type(screen.getByLabelText('Número'), '10')
    await userEvent.type(screen.getByLabelText('Bairro'), 'Centro')
    await userEvent.type(screen.getByLabelText('Cidade'), 'Itapema')
    await userEvent.type(screen.getByLabelText('UF'), 'sc')
    await userEvent.click(screen.getByRole('button', { name: 'Emitir' }))

    expect(postedBodies(fetchMock)[0].takers).toEqual([
      {
        patientId: 'p1',
        cpf: '390.533.447-05',
        address: {
          zip: '88220-000',
          street: 'Rua A',
          number: '10',
          complement: null,
          neighborhood: 'Centro',
          city: 'Itapema',
          state: 'SC',
        },
      },
    ])
  })

  it('goes back to the clinic address without sending a taker', async () => {
    const fetchMock = mockPreview(false, { addressSource: 'clinic', current: { ...BLANK_TAKER, cpf: '390.533.447-05' } })
    renderDialog()

    await userEvent.click(await screen.findByText('Preencher endereço do paciente'))
    await userEvent.click(screen.getByText('Usar endereço da clínica'))
    expect(screen.queryByLabelText('CEP')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Emitir' }))

    expect(postedBodies(fetchMock)[0].takers).toBeUndefined()
  })

  it.each([
    [{ emailSent: true }, 'Enviada por email para maria@example.com'],
    [{ email: null, emailSent: false }, 'Paciente sem email: a nota não foi enviada.'],
    [{ emailSent: false }, 'O email não foi enviado. Reenvie pelo menu da NFS-e.'],
  ])('shows the issued note with its number, value, documents and email outcome (%o)', async (email, line) => {
    mockPreview(false, {}, [[{ ...ISSUED, ...email }]])
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderDialog()

    await userEvent.click(await screen.findByRole('button', { name: 'Emitir' }))

    expect(await screen.findByRole('heading', { name: 'NFS-e emitida' })).toBeInTheDocument()
    expect(screen.queryByText('Confira os dados antes de emitir a nota fiscal.')).not.toBeInTheDocument()
    expect(screen.getByText('NFS-e nº 12')).toBeInTheDocument()
    expect(screen.getByText('Maria · R$ 500,00')).toBeInTheDocument()
    expect(screen.getByText(line)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ver PDF' }))
    await userEvent.click(screen.getByRole('button', { name: 'Baixar XML' }))
    expect(open.mock.calls.map(([url]) => url)).toEqual(['/api/nfse/doc-1/pdf', '/api/nfse/doc-1/xml'])
  })

  it("retries a rejected note from the result and shows Sefin's new answer", async () => {
    const failed = { ...ISSUED, status: 'failed', nfseNumber: null, emailSent: false, errorMessage: 'E1235: Falha no esquema XML do DF-e.' }
    const fetchMock = mockPreview(false, {}, [[failed], [ISSUED]])
    renderDialog()

    await userEvent.click(await screen.findByRole('button', { name: 'Emitir' }))
    expect(await screen.findByRole('heading', { name: 'Resultado da emissão' })).toBeInTheDocument()
    expect(screen.getByText('NFS-e não emitida')).toBeInTheDocument()
    expect(screen.getByText('E1235: Falha no esquema XML do DF-e.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))

    expect(await screen.findByText('NFS-e nº 12')).toBeInTheDocument()
    expect(postedBodies(fetchMock)[1].paymentRecordIds).toEqual(['pay-1'])
  })

  it('says the note is still processing when Sefin has not answered yet', async () => {
    mockPreview(false, {}, [[{ ...ISSUED, status: 'processing', nfseNumber: null, emailSent: false }]])
    renderDialog()

    await userEvent.click(await screen.findByRole('button', { name: 'Emitir' }))

    expect(await screen.findByText('Em processamento')).toBeInTheDocument()
    expect(screen.getByText('A Sefin ainda está processando. O status aparece no pagamento quando concluir.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver PDF' })).not.toBeInTheDocument()
  })
})
