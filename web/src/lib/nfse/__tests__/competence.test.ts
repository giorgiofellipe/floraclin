import { describe, expect, it } from 'vitest'
import { competenceIsPastMonth, defaultCompetenceDate } from '../competence'

const paidAt = new Date('2026-05-10T15:00:00Z')

describe('defaultCompetenceDate', () => {
  it('uses the procedure day over appointment and payment', () => {
    expect(
      defaultCompetenceDate({
        performedAt: new Date('2026-05-03T15:00:00Z'),
        appointmentDate: '2026-05-02',
        paidAt,
        today: '2026-05-10',
      }),
    ).toBe('2026-05-03')
  })

  it('uses the appointment day when no performed date', () => {
    expect(
      defaultCompetenceDate({ performedAt: null, appointmentDate: '2026-05-02', paidAt, today: '2026-05-10' }),
    ).toBe('2026-05-02')
  })

  it('falls back to the payment day', () => {
    expect(
      defaultCompetenceDate({ performedAt: null, appointmentDate: null, paidAt, today: '2026-05-10' }),
    ).toBe('2026-05-10')
  })

  it('clamps a future service day to today', () => {
    expect(
      defaultCompetenceDate({ performedAt: null, appointmentDate: '2026-05-20', paidAt, today: '2026-05-10' }),
    ).toBe('2026-05-10')
  })

  it('reads performedAt as a BR day', () => {
    expect(
      defaultCompetenceDate({
        performedAt: new Date('2026-03-01T01:30:00Z'),
        appointmentDate: null,
        paidAt,
        today: '2026-05-10',
      }),
    ).toBe('2026-02-28')
  })
})

describe('competenceIsPastMonth', () => {
  it('is true only for an earlier month', () => {
    expect(competenceIsPastMonth('2026-04-30', '2026-05-01')).toBe(true)
    expect(competenceIsPastMonth('2026-05-01', '2026-05-31')).toBe(false)
  })
})
