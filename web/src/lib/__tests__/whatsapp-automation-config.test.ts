import { describe, expect, it } from 'vitest'
import { nextAutomationRun } from '../whatsapp-automation-config'

// Instants are UTC; BR is UTC-3. A host-clock comparison would flip these on a UTC host.
describe('nextAutomationRun', () => {
  it.each([
    ['payment_reminder', '2026-11-14T11:59:00Z', 'hoje às 9h'],
    ['payment_reminder', '2026-11-14T12:00:00Z', 'amanhã às 9h'],
    ['appointment_confirmation', '2026-11-14T09:00:00Z', 'hoje às 6h30'],
    ['appointment_confirmation', '2026-11-15T01:00:00Z', 'amanhã às 6h30'],
  ] as const)('%s at %s runs %s', (trigger, now, expected) => {
    expect(nextAutomationRun(trigger, new Date(now))).toBe(expected)
  })
})
