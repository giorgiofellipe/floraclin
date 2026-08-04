import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReportFilters } from '../report-filters'

const usePractitioners = vi.fn()

vi.mock('@/hooks/queries/use-appointments', () => ({
  usePractitioners: (...args: unknown[]) => usePractitioners(...args),
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
})
