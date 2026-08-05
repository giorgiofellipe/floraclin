import { describe, it, expect } from 'vitest'
import { REPORTS, getReport } from '../registry'

describe('REPORTS registry', () => {
  // Only reports that declare the `threshold-days` filter kind read
  // `defaultDays` (see ReportShell/the filter UI); the sub-project 2 exports
  // use `date-range`/`practitioner` instead and never set it.
  it('gives every threshold-days report a positive integer defaultDays', () => {
    for (const report of REPORTS) {
      if (!report.filters.includes('threshold-days')) continue
      expect(Number.isInteger(report.defaultDays)).toBe(true)
      expect(report.defaultDays).toBeGreaterThan(0)
    }
  })

  // `paramName` and `filterLabel` are optional on the type (the date-range
  // reports don't have a day-count filter at all), so nothing but this test
  // stops a threshold-days report from shipping with an unnamed param or a
  // blank label above its input.
  it('gives every threshold-days report a paramName and a filterLabel', () => {
    for (const report of REPORTS) {
      if (!report.filters.includes('threshold-days')) continue
      expect(report.paramName, report.slug).toBeDefined()
      expect(report.filterLabel, report.slug).toBeTruthy()
    }
  })

  it('sets defaultMinCount on every report that declares the min-count filter', () => {
    for (const report of REPORTS) {
      if (!report.filters.includes('min-count')) continue
      expect(Number.isInteger(report.defaultMinCount), report.slug).toBe(true)
      expect(report.defaultMinCount, report.slug).toBeGreaterThan(0)
    }
  })

  // Same reasoning as defaultDays: the filter UI seeds the two date inputs
  // from this field and each route reads it as its own fallback, so a report
  // missing it would open with blank dates and an invisible window.
  it('gives every date-range report a positive integer defaultRangeDays', () => {
    for (const report of REPORTS) {
      if (!report.filters.includes('date-range')) continue
      expect(Number.isInteger(report.defaultRangeDays), report.slug).toBe(true)
      expect(report.defaultRangeDays, report.slug).toBeGreaterThan(0)
    }
  })

  it('defaults every date-range report to the last 90 days', () => {
    expect(getReport('extrato-periodo')?.defaultRangeDays).toBe(90)
    expect(getReport('ganhos-profissional')?.defaultRangeDays).toBe(90)
    expect(getReport('procedimentos-realizados')?.defaultRangeDays).toBe(90)
  })

  // These must match the fallback each report's route applies when the
  // day-count param is absent/blank; see the routes under
  // web/src/app/api/reports/*/route.ts.
  it('matches the known per-report defaults', () => {
    expect(getReport('pacientes-inativos')?.defaultDays).toBe(180)
    expect(getReport('retornos')?.defaultDays).toBe(30)
    expect(getReport('faltas')?.defaultDays).toBe(180)
  })

  it('gives every report an empty-state hint, so an empty table never looks broken', () => {
    for (const report of REPORTS) {
      expect(report.emptyHint, report.slug).toBeTruthy()
    }
  })

  // Only procedimentos-realizados declares the `patient` filter kind: a
  // clinic can have thousands of patients, so the control has to be a
  // SUGGEST/autocomplete, not a `<select>` listing every one of them (see
  // `PatientFilter` in report-filters.tsx). No other report filters by a
  // single patient.
  it('declares the patient filter only on procedimentos-realizados', () => {
    expect(getReport('procedimentos-realizados')?.filters).toContain('patient')
    for (const report of REPORTS) {
      if (report.slug === 'procedimentos-realizados') continue
      expect(report.filters, report.slug).not.toContain('patient')
    }
  })
})
