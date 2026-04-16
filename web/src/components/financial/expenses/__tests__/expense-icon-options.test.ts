import { describe, it, expect } from 'vitest'
import { EXPENSE_ICON_OPTIONS, getExpenseIcon } from '../expense-icon-options'
import { CircleIcon } from 'lucide-react'

describe('EXPENSE_ICON_OPTIONS', () => {
  it('contains 28 icons', () => {
    expect(EXPENSE_ICON_OPTIONS).toHaveLength(28)
  })

  it('has no duplicate values', () => {
    const values = EXPENSE_ICON_OPTIONS.map((o) => o.value)
    expect(new Set(values).size).toBe(values.length)
  })

  it('every option has value, label, and icon', () => {
    for (const opt of EXPENSE_ICON_OPTIONS) {
      expect(opt.value).toBeTruthy()
      expect(opt.label).toBeTruthy()
      expect(opt.icon).toBeTruthy()
    }
  })

  it('includes expected icons', () => {
    const values = EXPENSE_ICON_OPTIONS.map((o) => o.value)
    expect(values).toContain('syringe')
    expect(values).toContain('home')
    expect(values).toContain('circle')
    expect(values).toContain('scissors')
    expect(values).toContain('heart')
  })
})

describe('getExpenseIcon', () => {
  it('returns CircleIcon for unknown icon name', () => {
    expect(getExpenseIcon('nonexistent')).toBe(CircleIcon)
  })

  it('returns CircleIcon for null/undefined', () => {
    expect(getExpenseIcon(null as unknown as string)).toBe(CircleIcon)
    expect(getExpenseIcon(undefined as unknown as string)).toBe(CircleIcon)
  })

  it('returns correct icon for known name', () => {
    const icon = getExpenseIcon('home')
    expect(icon).toBeTruthy()
    expect(icon).not.toBe(CircleIcon)
  })

  it('handles case-insensitively', () => {
    const icon = getExpenseIcon('HOME')
    expect(icon).toBeTruthy()
    expect(icon).not.toBe(CircleIcon)
  })

  it('resolves legacy icon aliases', () => {
    for (const name of ['zap', 'droplet', 'shopping_cart', 'shopping-cart', 'book_open', 'book-open', 'car', 'globe']) {
      const icon = getExpenseIcon(name)
      expect(icon).not.toBe(CircleIcon)
    }
  })
})
