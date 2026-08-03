import { describe, it, expect } from 'vitest'
import { REPORTS, getReport } from '../registry'

describe('REPORTS registry', () => {
  it('gives every report a positive integer defaultDays', () => {
    for (const report of REPORTS) {
      expect(Number.isInteger(report.defaultDays)).toBe(true)
      expect(report.defaultDays).toBeGreaterThan(0)
    }
  })

  // These must match the fallback each report's route applies when the
  // day-count param is absent/blank; see the routes under
  // web/src/app/api/reports/*/route.ts.
  it('matches the known per-report defaults', () => {
    expect(getReport('pacientes-inativos')?.defaultDays).toBe(180)
    expect(getReport('retornos')?.defaultDays).toBe(30)
    expect(getReport('faltas')?.defaultDays).toBe(180)
  })
})
