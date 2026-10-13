import { describe, expect, it } from 'vitest'
import { getWhatsAppErrorLabel } from '@/lib/whatsapp-errors'

describe('getWhatsAppErrorLabel', () => {
  it('maps a known Meta delivery failure to its Portuguese label', () => {
    expect(getWhatsAppErrorLabel('131026')).toBe('Número sem WhatsApp ou inválido.')
  })

  it('groups template validation errors and falls back with the code', () => {
    expect(getWhatsAppErrorLabel('132012')).toBe('Problema no template aprovado pela Meta.')
    expect(getWhatsAppErrorLabel('999999')).toBe('Falha no WhatsApp (código 999999).')
  })

  it('has no label when there is no error code', () => {
    expect(getWhatsAppErrorLabel(null)).toBeNull()
  })
})
