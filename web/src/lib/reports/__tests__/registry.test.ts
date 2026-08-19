import { describe, it, expect } from 'vitest'
import { REPORTS, REPORT_GROUPS, getReport } from '../registry'
import type { ReportDefinition } from '../types'

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

  // The landing page groups cards by REPORT_GROUPS and skips any group with
  // no reports (see RelatoriosPage). Both directions matter: a report whose
  // group isn't in REPORT_GROUPS would never render anywhere, and a group in
  // REPORT_GROUPS with no reports would render as an empty heading if the
  // page didn't filter it out.
  it('gives every report a group that exists in REPORT_GROUPS', () => {
    const groupKeys = REPORT_GROUPS.map((group) => group.key)
    for (const report of REPORTS) {
      expect(groupKeys, report.slug).toContain(report.group)
    }
  })

  it('gives every group in REPORT_GROUPS at least one report', () => {
    for (const group of REPORT_GROUPS) {
      const reportsInGroup = REPORTS.filter((report) => report.group === group.key)
      expect(reportsInGroup.length, group.key).toBeGreaterThan(0)
    }
  })

  it('gives every group a title and a subtitle', () => {
    for (const group of REPORT_GROUPS) {
      expect(group.title, group.key).toBeTruthy()
      expect(group.subtitle, group.key).toBeTruthy()
    }
  })

  it('groups reports into the expected categories', () => {
    expect(getReport('pacientes-inativos')?.group).toBe('pacientes')
    expect(getReport('retornos')?.group).toBe('pacientes')
    expect(getReport('faltas')?.group).toBe('pacientes')
    expect(getReport('extrato-periodo')?.group).toBe('financeiro')
    expect(getReport('ganhos-profissional')?.group).toBe('financeiro')
    expect(getReport('procedimentos-realizados')?.group).toBe('clinico')
    expect(getReport('prontuario')?.group).toBe('clinico')
  })

  // procedimentos-realizados and prontuario are the only two reports that
  // declare the `patient` filter kind: a clinic can have thousands of
  // patients, so the control has to be a SUGGEST/autocomplete, not a
  // `<select>` listing every one of them (see `PatientFilter` in
  // report-filters.tsx). prontuario additionally requires it (see its
  // route, which 400s without a `patientId`); no other report filters by a
  // single patient.
  it('declares the patient filter only on procedimentos-realizados and prontuario', () => {
    const patientFilterSlugs = ['procedimentos-realizados', 'prontuario']
    for (const slug of patientFilterSlugs) {
      expect(getReport(slug)?.filters, slug).toContain('patient')
    }
    for (const report of REPORTS) {
      if (patientFilterSlugs.includes(report.slug)) continue
      expect(report.filters, report.slug).not.toContain('patient')
    }
  })
})

// `ReportDefinition.group` is a union (`ReportGroup`), not a free string, so
// an unrecognized group value must fail `tsc` at the assignment below rather
// than slip through as a silently-ungrouped report. This is a compile-time
// check only: nothing here executes, and there is no runtime assertion for
// it because the type system already rejects the invalid value.
function assertGroupIsAUnion(base: Omit<ReportDefinition, 'group'>): void {
  const valid: ReportDefinition = { ...base, group: 'financeiro' }
  void valid

  const invalid: ReportDefinition = {
    ...base,
    // @ts-expect-error 'not-a-real-group' is not a member of ReportGroup
    group: 'not-a-real-group',
  }
  void invalid
}
void assertGroupIsAUnion
