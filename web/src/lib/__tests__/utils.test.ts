import { describe, it, expect } from 'vitest'
import { formatDate, formatDateTime, formatCurrency, maskCPF, generateSlug, cn } from '../utils'

describe('formatDate', () => {
  it('formats a Date object to dd/MM/yyyy', () => {
    expect(formatDate(new Date(2025, 0, 15))).toBe('15/01/2025')
  })

  it('formats a string date', () => {
    expect(formatDate('2025-06-30T12:00:00')).toBe('30/06/2025')
  })

  it('formats end-of-year date', () => {
    expect(formatDate(new Date(2025, 11, 31))).toBe('31/12/2025')
  })

  it('formats a bare YYYY-MM-DD as that calendar day (no UTC round-trip)', () => {
    // Regression: `new Date('2026-04-16')` parses as UTC midnight which is
    // 21:00 BRT on 2026-04-15 — installments previously displayed one day
    // earlier than the stored due_date.
    expect(formatDate('2026-04-16')).toBe('16/04/2026')
    expect(formatDate('2026-01-01')).toBe('01/01/2026')
  })
})

describe('formatDateTime', () => {
  it('formats date and time with "as" separator', () => {
    const result = formatDateTime(new Date(2025, 2, 15, 14, 30))
    expect(result).toBe('15/03/2025 às 14:30')
  })

  it('formats midnight correctly', () => {
    const result = formatDateTime(new Date(2025, 0, 1, 0, 0))
    expect(result).toBe('01/01/2025 às 00:00')
  })

  it('formats string datetime', () => {
    const result = formatDateTime('2025-07-20T09:15:00')
    expect(result).toBe('20/07/2025 às 09:15')
  })
})

describe('formatCurrency', () => {
  it('formats zero', () => {
    expect(formatCurrency(0)).toMatch(/R\$\s*0,00/)
  })

  it('formats integer value', () => {
    expect(formatCurrency(100)).toMatch(/R\$\s*100,00/)
  })

  it('formats decimal value', () => {
    expect(formatCurrency(1234.56)).toMatch(/R\$\s*1\.234,56/)
  })

  it('formats negative value', () => {
    expect(formatCurrency(-50)).toMatch(/-\s*R\$\s*50,00/)
  })
})

describe('maskCPF (display masking)', () => {
  it('partially redacts a valid CPF string', () => {
    const result = maskCPF('12345678901')
    expect(result).toBe('***.456.***-**')
  })

  it('returns input unchanged if not 11 digits', () => {
    // The regex won't match, so the input is returned as-is
    expect(maskCPF('123')).toBe('123')
  })
})

describe('generateSlug', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(generateSlug('Hello World')).toBe('hello-world')
  })

  it('removes accented characters', () => {
    expect(generateSlug('Clínica Estética')).toBe('clinica-estetica')
  })

  it('removes special characters', () => {
    expect(generateSlug('Dr. João & Cia!')).toBe('dr-joao-cia')
  })

  it('trims leading and trailing hyphens', () => {
    expect(generateSlug('  --hello-- ')).toBe('hello')
  })

  it('collapses multiple non-alphanumeric chars into single hyphen', () => {
    expect(generateSlug('a   b___c')).toBe('a-b-c')
  })
})

describe('cn', () => {
  it('merges simple class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible')
  })

  it('merges Tailwind conflicting classes', () => {
    // tailwind-merge should keep the last one
    expect(cn('p-4', 'p-2')).toBe('p-2')
  })

  it('handles undefined and null gracefully', () => {
    expect(cn('foo', undefined, null, 'bar')).toBe('foo bar')
  })
})
