import { describe, it, expect, vi } from 'vitest'
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
