import { describe, expect, it } from 'vitest'
import { hasPlaceholderName, placeholderClinicName } from '../clinic-placeholder'

describe('placeholderClinicName', () => {
  it('uses the first name', () => {
    expect(placeholderClinicName('Ana Maria Souza')).toBe('Clínica de Ana')
    expect(placeholderClinicName('  Bia  ')).toBe('Clínica de Bia')
  })

  it('falls back when there is no name', () => {
    expect(placeholderClinicName(null)).toBe('Minha clínica')
    expect(placeholderClinicName(undefined)).toBe('Minha clínica')
    expect(placeholderClinicName('   ')).toBe('Minha clínica')
  })

  it('cuts a very long first name at 60 characters', () => {
    expect(placeholderClinicName('x'.repeat(500))).toBe(`Clínica de ${'x'.repeat(60)}`)
  })

  it('never splits an emoji when cutting', () => {
    expect(placeholderClinicName(`${'x'.repeat(59)}😀😀`)).toBe(`Clínica de ${'x'.repeat(59)}😀`)
  })
})

describe('hasPlaceholderName', () => {
  it('is true only for clinics still flagged', () => {
    expect(hasPlaceholderName({ clinic_name_placeholder: true })).toBe(true)
    expect(hasPlaceholderName({ clinic_name_placeholder: false })).toBe(false)
    expect(hasPlaceholderName({})).toBe(false)
    expect(hasPlaceholderName(null)).toBe(false)
  })
})
