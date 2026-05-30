import { describe, it, expect } from 'vitest'
import { assertNotProtectedTable, PROTECTED_TABLES } from '../compliance'

describe('assertNotProtectedTable', () => {
  it.each([
    'consent_acceptances',
    'procedure_records',
    'evaluation_responses',
    'clinical_documents',
    'anamneses',
    'photo_assets',
  ] as const)('throws for protected table %s', (table) => {
    expect(() => assertNotProtectedTable(table)).toThrowError(
      /prohibited.*Lei 13\.787/,
    )
  })

  it('does not throw for unprotected tables', () => {
    expect(() => assertNotProtectedTable('users')).not.toThrow()
    expect(() => assertNotProtectedTable('tenants')).not.toThrow()
    expect(() => assertNotProtectedTable('appointments')).not.toThrow()
  })

  it('exports the full list of protected tables', () => {
    expect(PROTECTED_TABLES).toHaveLength(6)
  })
})
