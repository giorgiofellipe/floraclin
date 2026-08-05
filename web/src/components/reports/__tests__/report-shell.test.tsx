import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReportShell } from '../report-shell'

vi.mock('@/hooks/queries/use-appointments', () => ({
  usePractitioners: () => ({ data: [] }),
}))

function renderShell(defaultDays: number) {
  return render(
    <ReportShell
      title="Pacientes inativos"
      description="desc"
      filters={['threshold-days']}
      apiPath="/api/reports/inactive-patients"
      paramName="thresholdDays"
      defaultDays={defaultDays}
      filterLabel="Limite (dias)"
    >
      {() => <div>table</div>}
    </ReportShell>,
  )
}

function getCsvHref() {
  return screen.getByRole('link', { name: /exportar csv/i }).getAttribute('href')!
}

describe('ReportShell', () => {
  it('renders the day-count input pre-filled with defaultDays on first render', () => {
    renderShell(180)

    const input = screen.getByLabelText(/limite \(dias\)/i) as HTMLInputElement
    expect(input.value).toBe('180')
  })

  it('carries the default value in the export href before the user touches anything', () => {
    renderShell(180)

    const params = new URLSearchParams(getCsvHref().split('?')[1])
    expect(params.get('thresholdDays')).toBe('180')
  })

  it('updates the input and export href when the user types a new value', async () => {
    renderShell(180)

    const input = screen.getByLabelText(/limite \(dias\)/i)
    await userEvent.clear(input)
    await userEvent.type(input, '45')

    expect((input as HTMLInputElement).value).toBe('45')
    const params = new URLSearchParams(getCsvHref().split('?')[1])
    expect(params.get('thresholdDays')).toBe('45')
  })

  it('falls back to sending no param (route default applies) when the user clears the input', async () => {
    renderShell(180)

    const input = screen.getByLabelText(/limite \(dias\)/i)
    await userEvent.clear(input)

    expect((input as HTMLInputElement).value).toBe('')
    const params = new URLSearchParams(getCsvHref().split('?')[1])
    expect(params.has('thresholdDays')).toBe(false)
  })

  it('renders the day-count label passed via filterLabel, not a hardcoded string', () => {
    render(
      <ReportShell
        title="Faltas recorrentes"
        description="desc"
        filters={['threshold-days']}
        apiPath="/api/reports/repeat-no-shows"
        paramName="windowDays"
        defaultDays={180}
        filterLabel="Período analisado (últimos dias)"
      >
        {() => <div>table</div>}
      </ReportShell>,
    )

    expect(screen.getByLabelText('Período analisado (últimos dias)')).toBeInTheDocument()
  })

  it('renders a date-range-only report without paramName, defaultDays or filterLabel', () => {
    render(
      <ReportShell
        title="Extrato por período"
        description="desc"
        filters={['date-range']}
        apiPath="/api/reports/extrato-periodo"
      >
        {() => <div>table</div>}
      </ReportShell>,
    )

    expect(screen.getByText('Extrato por período')).toBeInTheDocument()
    const params = new URLSearchParams(getCsvHref().split('?')[1])
    expect(params.has('thresholdDays')).toBe(false)
  })

  describe('date-range seeding', () => {
    // Fixed clock so the seeded window is a concrete pair of dates rather
    // than something recomputed from the same helpers the shell uses.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-08-03T15:00:00Z')) // BR noon on 2026-08-03
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    function renderRangeShell(defaultRangeDays?: number) {
      return render(
        <ReportShell
          title="Extrato por período"
          description="desc"
          filters={['date-range']}
          apiPath="/api/reports/extrato-periodo"
          defaultRangeDays={defaultRangeDays}
        >
          {(filterValues) => (
            <span data-testid="active-range">
              {filterValues.dateFrom ?? 'none'}..{filterValues.dateTo ?? 'none'}
            </span>
          )}
        </ReportShell>,
      )
    }

    it('seeds both date inputs with the default window so the user can see it', () => {
      renderRangeShell(90)

      // The DatePicker renders its value as dd/MM/yyyy.
      expect(screen.getByText('05/05/2026')).toBeInTheDocument()
      expect(screen.getByText('03/08/2026')).toBeInTheDocument()
    })

    it('hands the seeded range to the table on first render', () => {
      renderRangeShell(90)

      expect(screen.getByTestId('active-range')).toHaveTextContent('2026-05-05..2026-08-03')
    })

    it('carries the seeded range into the export href before anything is touched', () => {
      renderRangeShell(90)

      const params = new URLSearchParams(getCsvHref().split('?')[1])
      expect(params.get('dateFrom')).toBe('2026-05-05')
      expect(params.get('dateTo')).toBe('2026-08-03')
    })

    it('leaves the inputs blank when the report declares no defaultRangeDays', () => {
      renderRangeShell(undefined)

      expect(screen.getAllByText('dd/mm/aaaa')).toHaveLength(2)
      const params = new URLSearchParams(getCsvHref().split('?')[1])
      expect(params.has('dateFrom')).toBe(false)
      expect(params.has('dateTo')).toBe(false)
    })

    it('does not seed dates for a report that declares no date-range filter', () => {
      render(
        <ReportShell
          title="Pacientes inativos"
          description="desc"
          filters={['threshold-days']}
          apiPath="/api/reports/inactive-patients"
          paramName="thresholdDays"
          defaultDays={180}
          filterLabel="Limite (dias)"
          defaultRangeDays={90}
        >
          {() => <div>table</div>}
        </ReportShell>,
      )

      const params = new URLSearchParams(getCsvHref().split('?')[1])
      expect(params.has('dateFrom')).toBe(false)
      expect(params.has('dateTo')).toBe(false)
    })
  })

  describe('sort state', () => {
    function renderShellWithSortProbe() {
      return render(
        <ReportShell
          title="Pacientes inativos"
          description="desc"
          filters={['threshold-days']}
          apiPath="/api/reports/inactive-patients"
          paramName="thresholdDays"
          defaultDays={180}
          filterLabel="Limite (dias)"
        >
          {(_filters, sort, onSortChange) => (
            <div>
              <span data-testid="sort-state">{sort ? `${sort.key}:${sort.dir}` : 'none'}</span>
              <button onClick={() => onSortChange('daysSince')}>sort-by-days</button>
              <button onClick={() => onSortChange('lifetimeValue')}>sort-by-value</button>
            </div>
          )}
        </ReportShell>,
      )
    }

    it('starts with no sort, so the route applies its own default order', () => {
      renderShellWithSortProbe()

      expect(screen.getByTestId('sort-state')).toHaveTextContent('none')
      const params = new URLSearchParams(getCsvHref().split('?')[1])
      expect(params.has('sort')).toBe(false)
      expect(params.has('dir')).toBe(false)
    })

    it('sets ascending direction on the first click of a new key', async () => {
      renderShellWithSortProbe()

      await userEvent.click(screen.getByRole('button', { name: 'sort-by-days' }))

      expect(screen.getByTestId('sort-state')).toHaveTextContent('daysSince:asc')
    })

    it('toggles direction on a second click of the same key', async () => {
      renderShellWithSortProbe()

      await userEvent.click(screen.getByRole('button', { name: 'sort-by-days' }))
      await userEvent.click(screen.getByRole('button', { name: 'sort-by-days' }))

      expect(screen.getByTestId('sort-state')).toHaveTextContent('daysSince:desc')
    })

    it('resets to ascending when switching to a different key', async () => {
      renderShellWithSortProbe()

      await userEvent.click(screen.getByRole('button', { name: 'sort-by-days' }))
      await userEvent.click(screen.getByRole('button', { name: 'sort-by-days' })) // now desc
      await userEvent.click(screen.getByRole('button', { name: 'sort-by-value' }))

      expect(screen.getByTestId('sort-state')).toHaveTextContent('lifetimeValue:asc')
    })

    it('carries the active sort into the export URL, matching what is on screen', async () => {
      renderShellWithSortProbe()

      await userEvent.click(screen.getByRole('button', { name: 'sort-by-days' }))

      const params = new URLSearchParams(getCsvHref().split('?')[1])
      expect(params.get('sort')).toBe('daysSince')
      expect(params.get('dir')).toBe('asc')
    })
  })
})
