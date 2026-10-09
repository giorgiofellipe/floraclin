import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { CalendarBlockRow } from '@/db/queries/calendar'
import { MonthView } from '../month-view'

const block: CalendarBlockRow = {
  id: 'b1',
  tenantId: 't1',
  practitionerId: null,
  practitionerName: null,
  source: 'manual',
  title: 'Feriado',
  date: '2026-10-20',
  startTime: null,
  endTime: null,
  allDay: true,
  status: 'confirmed',
}

describe('MonthView', () => {
  it('shows a block on its day and opens it without triggering the day click', () => {
    // Regression: month view rendered appointments only, so a closed day looked free.
    const onBlockClick = vi.fn()
    const onDayClick = vi.fn()
    render(
      <MonthView
        date={new Date('2026-10-20T12:00:00')}
        appointments={[]}
        calendarBlocks={[block, { ...block, id: 'b2', allDay: false, startTime: '14:00:00', endTime: '15:00:00', date: '2026-10-21' }]}
        onDayClick={onDayClick}
        onBlockClick={onBlockClick}
      />,
    )

    const chips = screen.getAllByRole('button', { name: /indisponível/i })
    expect(chips).toHaveLength(2)
    expect(chips[0]).toHaveTextContent('Dia inteiro')
    expect(chips[1]).toHaveTextContent('14:00')
    expect(screen.queryByText('Feriado')).not.toBeInTheDocument()

    fireEvent.click(chips[0])
    expect(onBlockClick).toHaveBeenCalledWith(block, expect.anything())
    expect(onDayClick).not.toHaveBeenCalled()
  })
})
