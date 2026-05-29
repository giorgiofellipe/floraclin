import { describe, it, expect } from 'vitest'
import { renderPlaceholders, buildDocumentPlaceholders } from '../placeholders'

describe('renderPlaceholders', () => {
  it('replaces tokens', () => {
    expect(renderPlaceholders('Hello {{n}}', { '{{n}}': 'world' })).toBe('Hello world')
  })
  it('handles tokens containing regex special chars', () => {
    expect(renderPlaceholders('a${{x}}b', { '{{x}}': 'Y' })).toBe('a$Yb')
  })
  it('replaces all occurrences', () => {
    expect(renderPlaceholders('{{n}}-{{n}}', { '{{n}}': 'a' })).toBe('a-a')
  })
})

describe('buildDocumentPlaceholders', () => {
  it('omits city in date.long when address has no city', () => {
    const map = buildDocumentPlaceholders({
      patient: { fullName: 'X', cpf: null, birthDate: null },
      practitioner: { displayName: 'Y', registryLine: 'CRM-SP 1' },
      tenant: { name: 'Z', address: null },
      date: new Date('2026-05-27T15:00:00Z'),
    })
    expect(map['{{date.long}}']).not.toContain(',')
  })
})
