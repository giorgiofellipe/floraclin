import { describe, it, expect } from 'vitest'
import { generateCpf, generatePhone, generateEmail, buildPatients } from '../identity'
import { PHONE_PREFIX } from '../config'
import { toBrYmd } from '@/lib/dates'

/**
 * Independently written CPF validator (does not reuse the module's
 * `cpfCheckDigit` helper) so the test actually proves the check digits are
 * correct per the standard algorithm, not just internally consistent.
 */
function isValidCpf(formatted: string): boolean {
  const digits = formatted.replace(/\D/g, '')
  if (digits.length !== 11) return false
  if (/^(\d)\1{10}$/.test(digits)) return false // reject repdigits

  const nums = digits.split('').map(Number)

  let sum = 0
  for (let i = 0; i < 9; i++) sum += nums[i] * (10 - i)
  let rem = sum % 11
  const d10 = rem < 2 ? 0 : 11 - rem
  if (d10 !== nums[9]) return false

  sum = 0
  for (let i = 0; i < 10; i++) sum += nums[i] * (11 - i)
  rem = sum % 11
  const d11 = rem < 2 ? 0 : 11 - rem
  if (d11 !== nums[10]) return false

  return true
}

describe('generateCpf', () => {
  it('produces a formatted CPF with valid check digits', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const cpf = generateCpf(seed)
      expect(cpf).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/)
      expect(isValidCpf(cpf)).toBe(true)
    }
  })

  it('is deterministic for a given seed', () => {
    expect(generateCpf(42)).toBe(generateCpf(42))
  })

  it('varies across seeds', () => {
    const cpfs = new Set(Array.from({ length: 50 }, (_, i) => generateCpf(i + 1)))
    expect(cpfs.size).toBe(50)
  })
})

describe('generatePhone', () => {
  it('starts with the safe prefix and pads the index to 3 digits', () => {
    expect(generatePhone(7)).toBe(`${PHONE_PREFIX}007`)
    expect(generatePhone(123)).toBe(`${PHONE_PREFIX}123`)
  })

  it('every generated phone starts with PHONE_PREFIX', () => {
    for (let i = 1; i <= 50; i++) {
      expect(generatePhone(i).startsWith(PHONE_PREFIX)).toBe(true)
    }
  })
})

describe('generateEmail', () => {
  it('formats as nome.sobrenome@example.com', () => {
    const taken = new Set<string>()
    expect(generateEmail('Maria Silva', taken)).toBe('maria.silva@example.com')
  })

  it('strips accents and lowercases', () => {
    const taken = new Set<string>()
    expect(generateEmail('Débora Araújo', taken)).toBe('debora.araujo@example.com')
  })

  it('every email ends with @example.com', () => {
    const taken = new Set<string>()
    const names = ['Ana Costa', 'João Souza', 'Camila Lima', 'Rafael Alves']
    for (const name of names) {
      expect(generateEmail(name, taken).endsWith('@example.com')).toBe(true)
    }
  })

  it('dedupes collisions with a numeric suffix', () => {
    const taken = new Set<string>()
    const first = generateEmail('Ana Costa', taken)
    const second = generateEmail('Ana Costa', taken)
    const third = generateEmail('Ana Costa', taken)
    expect(first).toBe('ana.costa@example.com')
    expect(second).toBe('ana.costa2@example.com')
    expect(third).toBe('ana.costa3@example.com')
    expect(new Set([first, second, third]).size).toBe(3)
  })
})

describe('buildPatients', () => {
  const today = new Date('2026-07-27T15:00:00.000Z')
  const patients = buildPatients(50, today)

  it('builds the requested count', () => {
    expect(patients).toHaveLength(50)
  })

  it('has no duplicate CPFs', () => {
    const cpfs = new Set(patients.map((p) => p.cpf))
    expect(cpfs.size).toBe(patients.length)
  })

  it('has no duplicate phones', () => {
    const phones = new Set(patients.map((p) => p.phone))
    expect(phones.size).toBe(patients.length)
  })

  it('has no duplicate emails', () => {
    const emails = new Set(patients.map((p) => p.email))
    expect(emails.size).toBe(patients.length)
  })

  it('every CPF is check-digit valid', () => {
    for (const p of patients) expect(isValidCpf(p.cpf)).toBe(true)
  })

  it('every phone starts with PHONE_PREFIX', () => {
    for (const p of patients) expect(p.phone.startsWith(PHONE_PREFIX)).toBe(true)
  })

  it('every email ends with @example.com', () => {
    for (const p of patients) expect(p.email.endsWith('@example.com')).toBe(true)
  })

  it('every age falls between 24 and 45', () => {
    const todayYear = Number(toBrYmd(today).split('-')[0])
    for (const p of patients) {
      const birthYear = Number(p.birthDate.split('-')[0])
      const age = todayYear - birthYear
      expect(age).toBeGreaterThanOrEqual(24)
      expect(age).toBeLessThanOrEqual(45)
    }
  })

  it('every birthDate is a well-formed YYYY-MM-DD string', () => {
    for (const p of patients) {
      expect(p.birthDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('is majority female', () => {
    const female = patients.filter((p) => p.gender === 'feminino').length
    const male = patients.filter((p) => p.gender === 'masculino').length
    expect(female + male).toBe(patients.length)
    expect(female).toBeGreaterThan(male)
  })

  it('splits referral sources roughly 45/35/20', () => {
    const instagram = patients.filter((p) => p.referralSource === 'instagram').length
    const indicacao = patients.filter((p) => p.referralSource === 'indicacao').length
    const google = patients.filter((p) => p.referralSource === 'google').length
    expect(instagram + indicacao + google).toBe(patients.length)

    // Proportional allocation on 50 items should land within a few points
    // of the target percentages, not drift into a different ordering.
    expect(instagram).toBeGreaterThanOrEqual(18)
    expect(instagram).toBeLessThanOrEqual(27)
    expect(indicacao).toBeGreaterThanOrEqual(14)
    expect(indicacao).toBeLessThanOrEqual(22)
    expect(google).toBeGreaterThanOrEqual(7)
    expect(google).toBeLessThanOrEqual(13)
  })

  it('is deterministic for the same inputs', () => {
    const again = buildPatients(50, today)
    expect(again.map((p) => p.cpf)).toEqual(patients.map((p) => p.cpf))
    expect(again.map((p) => p.email)).toEqual(patients.map((p) => p.email))
    expect(again.map((p) => p.birthDate)).toEqual(patients.map((p) => p.birthDate))
  })

  it('assigns a non-empty id, fullName, gender, birthDate and referralSource to every patient', () => {
    for (const p of patients) {
      expect(p.id).toBeTruthy()
      expect(p.fullName.trim().length).toBeGreaterThan(0)
      expect(['feminino', 'masculino']).toContain(p.gender)
      expect(p.birthDate).toBeTruthy()
      expect(p.referralSource).toBeTruthy()
    }
  })
})
