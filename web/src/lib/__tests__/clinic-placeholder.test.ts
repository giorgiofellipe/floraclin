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

describe('suggestedClinicName (onboarding prefill after Google sign-up)', () => {
  it('suggests "Clínica" and the Google profile name', async () => {
    const { suggestedClinicName } = await import('../clinic-placeholder')
    expect(suggestedClinicName('  Ana   Souza ', 'ana@gmail.com')).toBe('Clínica Ana Souza')
  })

  it('suggests nothing when the profile had no real name (the e-mail local part stood in)', async () => {
    const { suggestedClinicName } = await import('../clinic-placeholder')
    expect(suggestedClinicName('ana.souza93', 'ana.souza93@gmail.com')).toBe('')
    expect(suggestedClinicName('', 'x@y.com')).toBe('')
    expect(suggestedClinicName(null, null)).toBe('')
    expect(suggestedClinicName('1234', 'z@y.com')).toBe('')
  })

  it('stays within the clinic name column', async () => {
    const { suggestedClinicName } = await import('../clinic-placeholder')
    expect(Array.from(suggestedClinicName('A'.repeat(400), 'a@b.c')).length).toBe(255)
  })
})
