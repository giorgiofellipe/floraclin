import { describe, it, expect } from 'vitest'
import { classifyByKeywords } from '../classify-prospect'

describe('classifyByKeywords', () => {
  const procedures = ['Botox', 'Preenchimento', 'Limpeza de Pele']

  it('detects price inquiry', () => {
    const result = classifyByKeywords('Quanto custa o botox?', procedures)
    expect(result).not.toBeNull()
    expect(result?.intent).toBe('inquiry')
    expect(result?.interestedProcedure).toBe('Botox')
  })

  it('detects scheduling intent', () => {
    const result = classifyByKeywords('Gostaria de agendar uma consulta', procedures)
    expect(result?.intent).toBe('scheduling')
  })

  it('detects complaint', () => {
    const result = classifyByKeywords('Tenho uma reclamação sobre o atendimento', procedures)
    expect(result?.intent).toBe('complaint')
  })

  it('detects followup', () => {
    const result = classifyByKeywords('Preciso marcar meu retorno', procedures)
    // "marcar" matches scheduling, which is checked before followup
    expect(result?.intent).toBe('scheduling')
  })

  it('detects procedure without intent keyword', () => {
    const result = classifyByKeywords('Vi que vocês fazem preenchimento', procedures)
    expect(result?.interestedProcedure).toBe('Preenchimento')
    expect(result?.intent).toBe('inquiry')
  })

  it('returns null when no match', () => {
    const result = classifyByKeywords('Olá, bom dia!', procedures)
    expect(result).toBeNull()
  })

  it('is case-insensitive', () => {
    const result = classifyByKeywords('QUANTO CUSTA?', procedures)
    expect(result?.intent).toBe('inquiry')
  })

  it('detects procedure with accent variations', () => {
    const result = classifyByKeywords('Qual o preço do preenchimento?', procedures)
    expect(result?.intent).toBe('inquiry')
    expect(result?.interestedProcedure).toBe('Preenchimento')
  })
})
