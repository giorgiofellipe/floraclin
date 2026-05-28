import { describe, it, expect } from 'vitest'
import {
  nextDeliveredViaAfterChannel,
  nextDeliveredViaAfterWhatsapp,
} from '../clinical-documents'

describe('nextDeliveredViaAfterWhatsapp', () => {
  it('promotes "pending" (initial issuance state) to "whatsapp"', () => {
    expect(nextDeliveredViaAfterWhatsapp('pending')).toBe('whatsapp')
  })

  it('keeps "whatsapp" as "whatsapp" when re-sent', () => {
    expect(nextDeliveredViaAfterWhatsapp('whatsapp')).toBe('whatsapp')
  })

  it('promotes "download" to "multiple" (user downloaded, then sent)', () => {
    expect(nextDeliveredViaAfterWhatsapp('download')).toBe('multiple')
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

describe('nextDeliveredViaAfterChannel', () => {
  it('promotes "pending" to the incoming channel', () => {
    expect(nextDeliveredViaAfterChannel('pending', 'print')).toBe('print')
    expect(nextDeliveredViaAfterChannel('pending', 'download')).toBe('download')
    expect(nextDeliveredViaAfterChannel('pending', 'whatsapp')).toBe('whatsapp')
  })

  it('keeps current value when the same channel is repeated', () => {
    expect(nextDeliveredViaAfterChannel('print', 'print')).toBe('print')
    expect(nextDeliveredViaAfterChannel('download', 'download')).toBe('download')
  })

  it('promotes to "multiple" when a different channel is added', () => {
    expect(nextDeliveredViaAfterChannel('print', 'download')).toBe('multiple')
    expect(nextDeliveredViaAfterChannel('download', 'print')).toBe('multiple')
    expect(nextDeliveredViaAfterChannel('whatsapp', 'print')).toBe('multiple')
    expect(nextDeliveredViaAfterChannel('whatsapp', 'download')).toBe('multiple')
  })

  it('keeps "multiple" as "multiple" regardless of channel', () => {
    expect(nextDeliveredViaAfterChannel('multiple', 'print')).toBe('multiple')
    expect(nextDeliveredViaAfterChannel('multiple', 'download')).toBe('multiple')
    expect(nextDeliveredViaAfterChannel('multiple', 'whatsapp')).toBe('multiple')
  })
})
