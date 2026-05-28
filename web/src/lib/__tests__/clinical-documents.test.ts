import { describe, it, expect } from 'vitest'
import { nextDeliveredViaAfterWhatsapp } from '../clinical-documents'

describe('nextDeliveredViaAfterWhatsapp', () => {
  it('promotes "download" to "whatsapp"', () => {
    expect(nextDeliveredViaAfterWhatsapp('download')).toBe('whatsapp')
  })

  it('keeps "whatsapp" as "whatsapp" when re-sent', () => {
    expect(nextDeliveredViaAfterWhatsapp('whatsapp')).toBe('whatsapp')
  })

  it('promotes "print" to "multiple"', () => {
    expect(nextDeliveredViaAfterWhatsapp('print')).toBe('multiple')
  })

  it('keeps "multiple" as "multiple"', () => {
    expect(nextDeliveredViaAfterWhatsapp('multiple')).toBe('multiple')
  })

  it('treats unknown previous value as mixed (safety)', () => {
    expect(nextDeliveredViaAfterWhatsapp('something-else')).toBe('multiple')
  })
})
