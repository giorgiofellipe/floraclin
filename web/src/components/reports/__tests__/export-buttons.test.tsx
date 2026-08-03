import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExportButtons } from '../export-buttons'

describe('ExportButtons', () => {
  it('builds CSV and PDF hrefs from apiPath, not the page URL', () => {
    render(
      <ExportButtons
        apiPath="/api/reports/inactive-patients"
        paramName="thresholdDays"
        filters={{ thresholdDays: '90' }}
      />,
    )

    const csvHref = screen.getByRole('link', { name: /exportar csv/i }).getAttribute('href')
    const pdfHref = screen.getByRole('link', { name: /exportar pdf/i }).getAttribute('href')

    expect(csvHref).toMatch(/^\/api\/reports\/inactive-patients\?/)
    expect(pdfHref).toMatch(/^\/api\/reports\/inactive-patients\?/)
  })

  it('carries the active filters and format into the query string', () => {
    render(
      <ExportButtons
        apiPath="/api/reports/inactive-patients"
        paramName="thresholdDays"
        filters={{ thresholdDays: '90', practitionerId: 'prat-1' }}
      />,
    )

    const csvHref = screen.getByRole('link', { name: /exportar csv/i }).getAttribute('href')!
    const pdfHref = screen.getByRole('link', { name: /exportar pdf/i }).getAttribute('href')!

    const csvParams = new URLSearchParams(csvHref.split('?')[1])
    expect(csvParams.get('thresholdDays')).toBe('90')
    expect(csvParams.get('practitionerId')).toBe('prat-1')
    expect(csvParams.get('format')).toBe('csv')

    const pdfParams = new URLSearchParams(pdfHref.split('?')[1])
    expect(pdfParams.get('format')).toBe('pdf')
  })

  it('serializes the numeric filter under paramName, e.g. windowDays for retornos/faltas', () => {
    render(
      <ExportButtons
        apiPath="/api/reports/due-followups"
        paramName="windowDays"
        filters={{ thresholdDays: '45' }}
      />,
    )

    const csvHref = screen.getByRole('link', { name: /exportar csv/i }).getAttribute('href')!
    const params = new URLSearchParams(csvHref.split('?')[1])

    expect(params.get('windowDays')).toBe('45')
    expect(params.has('thresholdDays')).toBe(false)
  })

  it('omits filters that are absent rather than serializing empty values', () => {
    render(<ExportButtons apiPath="/api/reports/repeat-no-shows" paramName="windowDays" filters={{}} />)

    const csvHref = screen.getByRole('link', { name: /exportar csv/i }).getAttribute('href')!
    const params = new URLSearchParams(csvHref.split('?')[1])

    expect(params.has('windowDays')).toBe(false)
    expect(params.get('format')).toBe('csv')
  })
})
