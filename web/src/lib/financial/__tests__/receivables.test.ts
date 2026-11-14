import { describe, expect, it } from 'vitest'
import { dueBucket, dueLabel } from '../receivables'

const TODAY = '2026-11-14'

describe('dueLabel', () => {
  it.each([
    ['2026-11-11', 'Vencida há 3 dias'],
    ['2026-11-13', 'Vencida ontem'],
    ['2026-11-14', 'Vence hoje'],
    ['2026-11-15', 'Vence amanhã'],
    // Across a month and a year boundary the count stays in whole BR calendar days.
    ['2026-10-31', 'Vencida há 14 dias'],
    ['2027-01-02', 'Vence 02/01'],
  ])('%s reads "%s"', (due, label) => {
    expect(dueLabel(due, TODAY)).toBe(label)
  })
})

describe('dueBucket', () => {
  it.each([
    [{ isOverdue: true, nextDueDate: '2026-11-01' }, 'overdue'],
    // Past due but inside its grace period: the engine does not call it overdue yet.
    [{ isOverdue: false, nextDueDate: '2026-11-12' }, 'today'],
    [{ isOverdue: false, nextDueDate: null }, 'upcoming'],
  ] as const)('%o goes to %s', (entry, bucket) => {
    expect(dueBucket(entry, TODAY)).toBe(bucket)
  })
})
