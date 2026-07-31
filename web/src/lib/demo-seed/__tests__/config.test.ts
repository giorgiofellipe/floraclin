import { describe, it, expect } from 'vitest'
import { CATALOGUE, MONTH_MIX, TARGETS, PACKAGE_PRICE, SIX_MONTH_RECEIVED, SAFETY_SETTINGS } from '../config'

describe('demo-seed config', () => {
  it('mixes exactly the targeted number of procedures', () => {
    expect(MONTH_MIX.reduce((n, m) => n + m.qty, 0)).toBe(TARGETS.proceduresThisMonth)
  })

  it('reaches the gross target once the package price is applied', () => {
    const priceOf = (name: string) => CATALOGUE.find((c) => c.name === name)!.price
    const listTotal = MONTH_MIX.reduce((sum, m) => sum + priceOf(m.name) * m.qty, 0)
    const uplift = PACKAGE_PRICE - priceOf('Harmonização facial completa')
    expect(listTotal + uplift).toBe(TARGETS.grossThisMonth)
  })

  it('splits gross into received and pending', () => {
    expect(TARGETS.receivedThisMonth + TARGETS.pendingThisMonth).toBe(TARGETS.grossThisMonth)
  })

  it('derives net profit the way the app does', () => {
    expect(TARGETS.receivedThisMonth - TARGETS.expensesThisMonth).toBe(TARGETS.netProfitThisMonth)
  })

  it('ends the six-month series on the current month received figure', () => {
    expect(SIX_MONTH_RECEIVED.at(-1)).toBe(TARGETS.receivedThisMonth)
  })

  it('keeps the tenant out of the WhatsApp automations cron', () => {
    // The cron keeps a tenant when mode is unset or 'floraclin', else when
    // whatsapp_enabled is truthy. Both conditions must fail.
    expect(SAFETY_SETTINGS.whatsapp_mode).not.toBe('floraclin')
    expect(SAFETY_SETTINGS.whatsapp_enabled).toBe(false)
  })

  it('every catalogue entry has a non-null category', () => {
    for (const item of CATALOGUE) expect(item.category).toBeTruthy()
  })
})
