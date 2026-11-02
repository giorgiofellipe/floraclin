import { describe, expect, it } from 'vitest'
import { isValidCep, isValidCpf } from '../br-documents'

describe('isValidCpf', () => {
  it('accepts a valid CPF, rejects a wrong check digit', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true)
    expect(isValidCpf('52998224726')).toBe(false)
  })

  it('rejects repeated digits', () => {
    expect(isValidCpf('111.111.111-11')).toBe(false)
  })
})

describe('isValidCep', () => {
  it('accepts a masked 8-digit CEP', () => {
    expect(isValidCep('01310-100')).toBe(true)
    expect(isValidCep('0131-100')).toBe(false)
  })
})
