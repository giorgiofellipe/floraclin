import { describe, it, expect } from 'vitest'
import { maskPhone, maskCPF, maskCEP, maskCurrency, parseCurrency, unmask } from '../masks'

describe('maskPhone', () => {
  it('returns empty string for empty input', () => {
    expect(maskPhone('')).toBe('')
  })

  it('formats partial input (2 digits)', () => {
    expect(maskPhone('11')).toBe('(11')
  })

  it('formats partial input (5 digits)', () => {
    expect(maskPhone('11999')).toBe('(11) 999')
  })

  it('formats partial input (7 digits)', () => {
    expect(maskPhone('1199988')).toBe('(11) 99988')
  })

  it('formats complete phone number (11 digits)', () => {
    expect(maskPhone('11999887766')).toBe('(11) 99988-7766')
  })

  it('truncates overflow digits beyond 11', () => {
    expect(maskPhone('119998877661234')).toBe('(11) 99988-7766')
  })

  it('strips non-digit characters from input', () => {
    expect(maskPhone('(11) 99988-7766')).toBe('(11) 99988-7766')
  })
})

describe('maskCPF', () => {
  it('returns empty string for empty input', () => {
    expect(maskCPF('')).toBe('')
  })

  it('returns raw digits for 3 or fewer digits', () => {
    expect(maskCPF('123')).toBe('123')
  })

  it('formats with first dot for 4-6 digits', () => {
    expect(maskCPF('123456')).toBe('123.456')
  })

  it('formats with two dots for 7-9 digits', () => {
    expect(maskCPF('123456789')).toBe('123.456.789')
  })

  it('formats complete CPF with dots and dash', () => {
    expect(maskCPF('12345678901')).toBe('123.456.789-01')
  })

  it('truncates overflow digits beyond 11', () => {
    expect(maskCPF('1234567890199')).toBe('123.456.789-01')
  })

  it('strips non-digit characters', () => {
    expect(maskCPF('123.456.789-01')).toBe('123.456.789-01')
  })
})

describe('maskCEP', () => {
  it('returns empty string for empty input', () => {
    expect(maskCEP('')).toBe('')
  })

  it('returns raw digits for 5 or fewer digits', () => {
    expect(maskCEP('12345')).toBe('12345')
  })

  it('formats complete CEP with dash', () => {
    expect(maskCEP('12345678')).toBe('12345-678')
  })

  it('truncates overflow digits beyond 8', () => {
    expect(maskCEP('123456789')).toBe('12345-678')
  })

  it('strips non-digit characters', () => {
    expect(maskCEP('12345-678')).toBe('12345-678')
  })
})

describe('maskCurrency', () => {
  it('returns empty string for empty input', () => {
    expect(maskCurrency('')).toBe('')
  })

  it('formats single digit as centavos', () => {
    expect(maskCurrency('1')).toBe('0,01')
  })

  it('formats two digits as centavos', () => {
    expect(maskCurrency('12')).toBe('0,12')
  })

  it('formats three digits with reais and centavos', () => {
    expect(maskCurrency('123')).toBe('1,23')
  })

  it('formats five digits correctly', () => {
    expect(maskCurrency('12345')).toBe('123,45')
  })

  it('formats seven digits with thousands separator', () => {
    expect(maskCurrency('1234567')).toBe('12.345,67')
  })

  it('strips non-digit characters before formatting', () => {
    expect(maskCurrency('R$ 1.234,56')).toBe('1.234,56')
  })
})

describe('parseCurrency', () => {
  it('parses simple value', () => {
    expect(parseCurrency('1,23')).toBe(1.23)
  })

  it('parses value with thousands separator', () => {
    expect(parseCurrency('12.345,67')).toBe(12345.67)
  })

  it('parses centavos only', () => {
    expect(parseCurrency('0,01')).toBe(0.01)
  })
})

describe('unmask', () => {
  it('strips all non-digit characters', () => {
    expect(unmask('(11) 99988-7766')).toBe('11999887766')
  })

  it('returns empty string for non-digit input', () => {
    expect(unmask('abc')).toBe('')
  })

  it('returns digits unchanged', () => {
    expect(unmask('12345')).toBe('12345')
  })
})
