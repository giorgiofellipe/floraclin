import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@/tests/test-utils'

const PRACTITIONER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'

const mutateAsync = vi.fn()
vi.mock('@/hooks/queries/use-calendar', () => ({
  useCreateCalendarBlock: () => ({ mutateAsync, isPending: false }),
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('sonner', () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) },
}))

// The base-ui Select and DatePicker are not drivable from jsdom; native
// controls keep the form's own wiring under test.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    name,
    items,
    value,
    onValueChange,
  }: {
    name: string
    items: Record<string, string>
    value: string
    onValueChange: (v: string | null) => void
  }) => (
    <select data-testid={`select-${name}`} value={value} onChange={(e) => onValueChange(e.target.value || null)}>
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
vi.mock('@/components/ui/date-picker', () => ({
  DatePicker: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input type="date" data-testid="block-date" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

import { CalendarBlockForm } from '../calendar-block-form'

const practitioners = [
  { id: PRACTITIONER_ID, fullName: 'Dra. Ana' },
  { id: OTHER_ID, fullName: 'Dr. Bruno' },
]

function renderForm(props: Partial<React.ComponentProps<typeof CalendarBlockForm>> = {}) {
  const onOpenChange = vi.fn()
  renderWithProviders(
    <CalendarBlockForm
      open
      onOpenChange={onOpenChange}
      practitioners={practitioners}
      canBlockClinic
      defaultDate="2026-10-12"
      {...props}
    />,
  )
  return { onOpenChange }
}

beforeEach(() => {
  mutateAsync.mockReset()
  mutateAsync.mockResolvedValue({})
  toastError.mockClear()
  toastSuccess.mockClear()
})

describe('CalendarBlockForm', () => {
  // An all-day clinic block must reach the API with a null practitioner and no times.
  it('submits an all-day clinic-wide block without times', async () => {
    renderForm()
    fireEvent.change(screen.getByTestId('select-practitionerId'), { target: { value: 'clinic' } })
    fireEvent.click(screen.getByRole('switch', { name: /dia inteiro/i }))
    fireEvent.click(screen.getByRole('button', { name: /bloquear horário/i }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    expect(mutateAsync).toHaveBeenCalledWith({
      practitionerId: null,
      date: '2026-10-12',
      allDay: true,
      title: '',
    })
    expect(screen.queryByTestId('select-startTime')).not.toBeInTheDocument()
  })

  // A timed block must carry the default 08:00 to 09:00 range.
  it('submits the default time range for a timed block', async () => {
    renderForm()
    fireEvent.change(screen.getByTestId('select-practitionerId'), { target: { value: PRACTITIONER_ID } })
    fireEvent.click(screen.getByRole('button', { name: /bloquear horário/i }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    expect(mutateAsync).toHaveBeenCalledWith({
      practitionerId: PRACTITIONER_ID,
      date: '2026-10-12',
      allDay: false,
      startTime: '08:00',
      endTime: '09:00',
      title: '',
    })
    expect(toastSuccess).toHaveBeenCalledWith('Horário bloqueado')
  })

  // Only owners may block the whole clinic.
  it('hides the clinic option without permission', () => {
    renderForm({ canBlockClinic: false })
    expect(screen.queryByRole('option', { name: 'Toda a clínica' })).not.toBeInTheDocument()
  })

  it('preselects the given practitioner instead of the whole clinic', () => {
    renderForm({ defaultPractitionerId: OTHER_ID })
    expect(screen.getByTestId('select-practitionerId')).toHaveValue(OTHER_ID)
  })

  it('falls back to the first practitioner when the default is not in the list', () => {
    renderForm({ defaultPractitionerId: '33333333-3333-4333-8333-333333333333' })
    expect(screen.getByTestId('select-practitionerId')).toHaveValue(PRACTITIONER_ID)
  })

  it('moves the end time forward when the start passes it', () => {
    renderForm()
    fireEvent.change(screen.getByTestId('select-startTime'), { target: { value: '10:00' } })
    const endSelect = screen.getByTestId('select-endTime')
    expect(endSelect).toHaveValue('10:30')
    expect(within(endSelect).queryByRole('option', { name: '09:00' })).not.toBeInTheDocument()
  })

  // A practitioner is pinned to their own agenda.
  it('hides the select and submits the locked practitioner', async () => {
    renderForm({ canBlockClinic: false, lockedPractitionerId: OTHER_ID })
    expect(screen.queryByTestId('select-practitionerId')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /bloquear horário/i }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ practitionerId: OTHER_ID }))
  })

  // A server rejection must keep the dialog open and surface the server message.
  it('keeps the dialog open and toasts the server error', async () => {
    mutateAsync.mockRejectedValue(new Error('Você só pode bloquear a sua própria agenda'))
    const { onOpenChange } = renderForm()
    fireEvent.click(screen.getByRole('button', { name: /bloquear horário/i }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Você só pode bloquear a sua própria agenda'))
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
