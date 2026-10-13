import { describe, expect, it } from 'vitest'
import { getWhatsAppErrorLabel } from '@/lib/whatsapp-errors'

describe('getWhatsAppErrorLabel', () => {
  it('maps common Meta delivery failures to short Portuguese labels', () => {
    expect(getWhatsAppErrorLabel('131026')).toBe('Número sem WhatsApp ou inválido.')
    expect(getWhatsAppErrorLabel('131049')).toBe('Meta limitou a entrega.')
    expect(getWhatsAppErrorLabel('131047')).toBe('Janela de 24h expirada.')
    expect(getWhatsAppErrorLabel('131051')).toBe('Tipo de mensagem não suportado.')
    expect(getWhatsAppErrorLabel('470')).toBe('Janela de 24h expirada.')
    expect(getWhatsAppErrorLabel('130472')).toBe('Entrega limitada por política da Meta.')
  })

  it('groups template validation errors and falls back with the code', () => {
    expect(getWhatsAppErrorLabel('132012')).toBe('Problema no template aprovado pela Meta.')
    expect(getWhatsAppErrorLabel('999999')).toBe('Falha no WhatsApp (código 999999).')
    expect(getWhatsAppErrorLabel(null)).toBeNull()
  })
})
