import { describe, it, expect } from 'vitest'
import { hashEmail, hashPhone, hashName, splitFullName, sha256Hex } from '../hashing'

describe('sha256Hex', () => {
  it('produces the known digest for a known input', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('hashEmail', () => {
  it('lowercases and trims before hashing', () => {
    expect(hashEmail('  Ana@Clinica.COM  ')).toBe(sha256Hex('ana@clinica.com'))
  })

  it('returns undefined for empty input', () => {
    expect(hashEmail('')).toBeUndefined()
    expect(hashEmail(null)).toBeUndefined()
    expect(hashEmail(undefined)).toBeUndefined()
  })
})

describe('hashPhone', () => {
  it('hashes the canonical 55DDD form so both sources collapse to one digest', () => {
    // The same person typed nationally and delivered by Meta without the 9th digit.
    expect(hashPhone('(47) 98844-3635')).toBe(hashPhone('554788443635'))
  })

  it('hashes E.164 digits with no plus sign', () => {
    expect(hashPhone('(47) 98844-3635')).toBe(sha256Hex('5547988443635'))
  })

  it('returns undefined for input it cannot canonicalize', () => {
    expect(hashPhone('')).toBeUndefined()
    expect(hashPhone(null)).toBeUndefined()
  })
})

describe('hashName', () => {
  it('lowercases and strips accents', () => {
    expect(hashName('Conceição')).toBe(sha256Hex('conceicao'))
  })

  it('trims surrounding whitespace', () => {
    expect(hashName('  Ana  ')).toBe(sha256Hex('ana'))
  })

  it('returns undefined for empty input', () => {
    expect(hashName('   ')).toBeUndefined()
  })
})

describe('splitFullName', () => {
  it('splits first and last from a multi-part name', () => {
    expect(splitFullName('Ana Paula Souza')).toEqual({ first: 'Ana', last: 'Souza' })
  })

  it('returns only a first name when there is one part', () => {
    expect(splitFullName('Ana')).toEqual({ first: 'Ana' })
  })

  it('returns an empty object for no name', () => {
    expect(splitFullName(null)).toEqual({})
  })
})
