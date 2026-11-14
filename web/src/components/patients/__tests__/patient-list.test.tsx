import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderWithProviders } from '@/tests/test-utils'
import { SubscriptionAccessProvider } from '@/components/layout/subscription-access'
import { PatientList } from '../patient-list'
import type { PatientListRow } from '@/db/queries/patients'
import type { PaginatedResult } from '@/types'

const replace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/pacientes',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('../patient-form', () => ({
  PatientForm: ({ open, patient }: { open: boolean; patient?: { fullName: string } | null }) =>
    open ? <div data-testid="patient-form-open">{patient ? `editando ${patient.fullName}` : 'novo'}</div> : null,
}))

vi.mock('@/hooks/queries/use-birthdays', () => ({
  useBirthdays: () => ({ data: [{}, {}, {}] }),
}))

function makeResult(patients: PatientListRow[]): PaginatedResult<PatientListRow> {
  return { data: patients, total: patients.length, page: 1, limit: 20, totalPages: 1 }
}

function makePatient(overrides: Partial<PatientListRow> = {}): PatientListRow {
  return {
    id: 'p1',
    fullName: 'Maria Silva',
    phone: '5511999990000',
    createdAt: new Date('2025-01-15T12:00:00Z'),
    nextAppointmentAt: null,
    lastVisitDate: null,
    ...overrides,
  } as PatientListRow
}

function render(ui: React.ReactElement, role = 'owner') {
  return renderWithProviders(
    <SubscriptionAccessProvider readOnly={false} reason={null} tenantId="t1" canSubscribe plans={[]} role={role}>
      {ui}
    </SubscriptionAccessProvider>,
  )
}

function stubViewport(desktop: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches: desktop }))
}

beforeEach(() => {
  replace.mockClear()
  stubViewport(true)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('PatientList', () => {
  it('syncs the search to the URL once typing pauses, without a Buscar button', () => {
    vi.useFakeTimers()
    render(<PatientList result={makeResult([makePatient()])} />)

    expect(screen.queryByRole('button', { name: 'Buscar' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByTestId('patient-search'), { target: { value: 'mar' } })
    expect(replace).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(300))
    expect(replace).toHaveBeenCalledWith('/pacientes?busca=mar', { scroll: false })
  })

  it('follows the URL search on back navigation', () => {
    const { rerender } = render(<PatientList result={makeResult([makePatient()])} search="maria" />)
    rerender(
      <SubscriptionAccessProvider readOnly={false} reason={null} tenantId="t1" canSubscribe plans={[]} role="owner">
        <PatientList result={makeResult([makePatient()])} search="" />
      </SubscriptionAccessProvider>,
    )
    expect(screen.getByTestId('patient-search')).toHaveValue('')
  })

  it('focuses the search on open on desktop, but not on the phone where the keyboard would hide the list', () => {
    const { unmount } = render(<PatientList result={makeResult([makePatient()])} />)
    expect(screen.getByTestId('patient-search')).toHaveFocus()
    unmount()

    stubViewport(false)
    render(<PatientList result={makeResult([makePatient()])} />)
    expect(screen.getByTestId('patient-search')).not.toHaveFocus()
  })

  it('offers WhatsApp and Agendar per patient and keeps delete out of the row', () => {
    render(<PatientList result={makeResult([makePatient()])} />)

    const row = screen.getByTestId('patient-row-0')
    expect(within(row).getByRole('link', { name: 'WhatsApp de Maria Silva' })).toHaveAttribute(
      'href',
      'https://wa.me/5511999990000',
    )
    expect(within(row).getByRole('link', { name: 'Agendar Maria Silva' })).toHaveAttribute(
      'href',
      '/agenda?open=new&patient=p1&patientName=Maria+Silva',
    )
    expect(screen.queryByTitle('Excluir')).not.toBeInTheDocument()
  })

  it('edits a patient from the row without opening the record', () => {
    render(<PatientList result={makeResult([makePatient()])} />)
    fireEvent.click(within(screen.getByTestId('patient-row-0')).getByRole('button', { name: 'Editar Maria Silva' }))
    expect(screen.getByTestId('patient-form-open')).toHaveTextContent('editando Maria Silva')
  })

  it('keeps e-mail and CPF visible without their own columns', () => {
    render(
      <PatientList result={makeResult([makePatient({ email: 'maria@test.com', cpf: '123.456.789-00' })])} />,
    )
    expect(screen.getByTestId('patient-row-0')).toHaveTextContent('maria@test.com · CPF ***.456.***-**')
  })

  it('hides Agendar, Editar and Novo Paciente from the financial role, which the API rejects', () => {
    render(<PatientList result={makeResult([makePatient()])} />, 'financial')
    expect(screen.queryByRole('link', { name: /^Agendar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Editar/ })).not.toBeInTheDocument()
    expect(screen.queryByTestId('patient-new-button')).not.toBeInTheDocument()
  })

  it('sorts by last visit, most recent first, from the column header', () => {
    render(<PatientList result={makeResult([makePatient()])} />)
    fireEvent.click(screen.getByRole('button', { name: 'Última visita' }))
    expect(replace).toHaveBeenCalledWith('/pacientes?ordem=ultima-visita&direcao=desc', { scroll: false })
  })

  it('shows the month birthday count on the Aniversariantes chip', () => {
    render(<PatientList result={makeResult([makePatient()])} />)
    expect(screen.getByTestId('patient-birthdays-chip')).toHaveTextContent(/3\s*este mês/)
  })

  it('leads an empty clinic to register its first patient', () => {
    render(<PatientList result={makeResult([])} />)
    expect(screen.getByTestId('patient-empty-state')).toHaveTextContent('Nenhum paciente cadastrado')
    expect(screen.getByRole('button', { name: /cadastrar primeiro paciente/i })).toBeInTheDocument()
  })
})
