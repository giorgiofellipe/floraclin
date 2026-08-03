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
})
