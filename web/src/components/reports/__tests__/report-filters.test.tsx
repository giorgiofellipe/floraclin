import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReportFilters } from '../report-filters'

const usePractitioners = vi.fn()
const usePatientSearch = vi.fn()

vi.mock('@/hooks/queries/use-appointments', () => ({
  usePractitioners: (...args: unknown[]) => usePractitioners(...args),
}))

vi.mock('@/hooks/queries/use-patients', () => ({
  usePatientSearch: (...args: unknown[]) => usePatientSearch(...args),
}))

describe('ReportFilters', () => {
  it('only fetches practitioners when the report declares the practitioner filter kind', () => {
    usePractitioners.mockReturnValue({ data: [] })

    render(<ReportFilters filters={['date-range']} value={{}} onChange={() => {}} />)

    expect(usePractitioners).toHaveBeenCalledWith({ enabled: false })
  })

  it('enables the practitioners fetch when the practitioner filter kind is present', () => {
    usePractitioners.mockReturnValue({ data: [] })

    render(<ReportFilters filters={['date-range', 'practitioner']} value={{}} onChange={() => {}} />)

    expect(usePractitioners).toHaveBeenCalledWith({ enabled: true })
  })

  it('renders the date-range picker and reflects the current dateFrom/dateTo values', () => {
    usePractitioners.mockReturnValue({ data: [] })

    render(
      <ReportFilters
        filters={['date-range']}
        value={{ dateFrom: '2026-04-01', dateTo: '2026-04-30' }}
        onChange={() => {}}
      />,
    )

    // The DatePicker displays the value formatted as dd/MM/yyyy; two distinct
    // formatted values proves both dateFrom and dateTo made it through as
    // separate, independently controlled inputs, not the same value twice.
    expect(screen.getByText('01/04/2026')).toBeInTheDocument()
    expect(screen.getByText('30/04/2026')).toBeInTheDocument()
  })

  it('renders two empty date inputs when no date-range value is set yet', () => {
    usePractitioners.mockReturnValue({ data: [] })

    render(<ReportFilters filters={['date-range']} value={{}} onChange={() => {}} />)

    expect(screen.getAllByText('dd/mm/aaaa')).toHaveLength(2)
  })

  it('renders a practitioner select populated from usePractitioners and reports selection', async () => {
    usePractitioners.mockReturnValue({
      data: [
        { id: 'p1', fullName: 'Dra. Ana' },
        { id: 'p2', fullName: 'Dr. Bruno' },
      ],
    })
    const onChange = vi.fn()

    render(<ReportFilters filters={['practitioner']} value={{}} onChange={onChange} />)

    const trigger = screen.getByRole('combobox')
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByText('Dra. Ana'))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ practitionerId: 'p1' }))
  })

  it('clears practitionerId when "Todos os profissionais" is selected', async () => {
    usePractitioners.mockReturnValue({ data: [{ id: 'p1', fullName: 'Dra. Ana' }] })
    const onChange = vi.fn()

    render(
      <ReportFilters
        filters={['practitioner']}
        value={{ practitionerId: 'p1' }}
        onChange={onChange}
      />,
    )

    const trigger = screen.getByRole('combobox')
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByText('Todos os profissionais'))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ practitionerId: undefined }))
  })

  it('renders nothing when the report declares no filters', () => {
    usePractitioners.mockReturnValue({ data: [] })

    const { container } = render(<ReportFilters filters={[]} value={{}} onChange={() => {}} />)

    expect(container).toBeEmptyDOMElement()
  })

  describe('patient filter', () => {
    beforeEach(() => {
      usePractitioners.mockReturnValue({ data: [] })
      usePatientSearch.mockReturnValue({ data: [], isFetching: false })
    })

    it('does not render the patient combobox for a report that does not declare it', () => {
      render(<ReportFilters filters={['date-range']} value={{}} onChange={() => {}} />)

      expect(screen.queryByTestId('report-patient-filter-trigger')).not.toBeInTheDocument()
    })

    it('renders a SUGGEST-style combobox, not a plain select, when the patient filter kind is present', () => {
      render(<ReportFilters filters={['patient']} value={{}} onChange={() => {}} />)

      // A trigger button that opens a search popover, not a <select>: proven
      // by there being no extra "combobox" role element for it (that role is
      // reserved for the practitioner Select in this file's other tests).
      expect(screen.getByTestId('report-patient-filter-trigger')).toBeInTheDocument()
      expect(screen.getByText('Todos os pacientes')).toBeInTheDocument()
    })

    it('reports the selected patientId once a search result is picked', async () => {
      usePatientSearch.mockReturnValue({
        data: [{ id: 'pat-1', fullName: 'Ana Souza' }],
        isFetching: false,
      })
      const onChange = vi.fn()

      render(<ReportFilters filters={['patient']} value={{}} onChange={onChange} />)
      await userEvent.click(screen.getByTestId('report-patient-filter-trigger'))
      // The result list only shows once at least 2 characters are typed
      // (see PatientFilter): a 1-character query against a clinic with
      // thousands of patients isn't a useful list to render.
      await userEvent.type(screen.getByTestId('report-patient-filter-search'), 'an')
      await userEvent.click(await screen.findByTestId('report-patient-filter-option-pat-1'))

      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'pat-1' }))
    })

    it('clears patientId when "Todos os pacientes" is clicked', async () => {
      const onChange = vi.fn()

      render(
        <ReportFilters filters={['patient']} value={{ patientId: 'pat-1' }} onChange={onChange} />,
      )
      await userEvent.click(screen.getByTestId('report-patient-filter-trigger'))
      await userEvent.click(screen.getByTestId('report-patient-filter-clear'))

      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ patientId: undefined }))
    })

    it('prompts for at least 2 characters before showing any results', async () => {
      render(<ReportFilters filters={['patient']} value={{}} onChange={() => {}} />)
      await userEvent.click(screen.getByTestId('report-patient-filter-trigger'))
      await userEvent.type(screen.getByTestId('report-patient-filter-search'), 'a')

      expect(screen.getByText('Digite ao menos 2 letras para buscar')).toBeInTheDocument()
    })
  })
})
