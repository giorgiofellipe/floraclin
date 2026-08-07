import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/tests/test-utils'

vi.mock('@/hooks/queries/use-appointments', () => ({
  usePractitioners: () => ({ data: [] }),
}))

vi.mock('@/hooks/queries/use-patients', () => ({
  usePatientSearch: () => ({
    data: [{ id: '22222222-2222-2222-2222-222222222222', fullName: 'Ana Souza' }],
    isFetching: false,
  }),
}))

import ProntuarioPage from '../page'

const PATIENT_ID = '22222222-2222-2222-2222-222222222222'

const SUMMARY_RESPONSE = {
  data: {
    patient: {
      fullName: 'Ana Souza',
      phone: '11987654321',
      cpf: '123.456.789-00',
      birthDate: '1990-05-20',
      gender: 'feminino',
      email: 'ana@example.com',
    },
    anamnesis: { mainComplaint: 'Rugas de expressão' },
    procedures: [
      {
        id: 'proc-1',
        procedureTypeName: 'Botox',
        performedAt: '2026-04-10T15:00:00.000Z',
        practitionerName: 'Dra. Beatriz',
        productApplications: [],
      },
    ],
    proceduresTruncated: false,
    photos: [{ stage: 'pre', label: 'Pré', photos: [{ id: 'p1' }] }],
    consents: [{ id: 'consent-1', templateTitle: 'Termo Botox', acceptedAt: '2026-03-01T13:00:00.000Z' }],
  },
}

const EMPTY_SUMMARY_RESPONSE = {
  data: {
    patient: {
      fullName: 'Beto Lima',
      phone: '11999998888',
      cpf: null,
      birthDate: null,
      gender: null,
      email: null,
    },
    anamnesis: null,
    procedures: [],
    proceduresTruncated: false,
    photos: [],
    consents: [],
  },
}

const fetchMock = vi.fn()

async function selectPatient(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('report-patient-filter-trigger'))
  await user.type(screen.getByTestId('report-patient-filter-search'), 'ana')
  await user.click(await screen.findByTestId(`report-patient-filter-option-${PATIENT_ID}`))
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify(SUMMARY_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ProntuarioPage', () => {
  it('shows an empty state prompting for a patient and never fetches without one', async () => {
    renderWithProviders(<ProntuarioPage />)

    expect(screen.getByText('Escolha um paciente para gerar o prontuário completo.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches the dossier for the selected patient and renders the summary', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ProntuarioPage />)

    await selectPatient(user)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain(`patientId=${PATIENT_ID}`)
    expect(url).not.toContain('format=')

    expect((await screen.findAllByText('Ana Souza')).length).toBeGreaterThan(0)
    expect(screen.getByText(/Rugas de expressão/)).toBeInTheDocument()
    expect(screen.getByText(/1 procedimento\(s\)/)).toBeInTheDocument()
  })

  it('never offers a CSV export, only a PDF download pointed at the prontuário route', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ProntuarioPage />)

    await selectPatient(user)
    await screen.findAllByText('Ana Souza')

    expect(screen.queryByText(/exportar csv/i)).not.toBeInTheDocument()

    const pdfLink = screen.getByRole('link', { name: /baixar pdf do prontuário/i })
    const href = pdfLink.getAttribute('href')!
    expect(href).toContain(`patientId=${PATIENT_ID}`)
    expect(href).toContain('format=pdf')
  })

  it('renders empty sections for a patient with no anamnese, photos or consents, without throwing', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify(EMPTY_SUMMARY_RESPONSE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    const user = userEvent.setup()
    renderWithProviders(<ProntuarioPage />)

    await selectPatient(user)

    expect(await screen.findByText('Beto Lima')).toBeInTheDocument()
    expect(screen.getByText('Não preenchida.')).toBeInTheDocument()
    expect(screen.getByText('Nenhum procedimento registrado.')).toBeInTheDocument()
    expect(screen.getByText('Nenhuma foto registrada.')).toBeInTheDocument()
    expect(screen.getByText('Nenhum termo assinado.')).toBeInTheDocument()
  })
})
