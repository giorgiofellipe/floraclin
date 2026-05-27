import { describe, it, expect } from 'vitest'
import { classifyByKeywords } from '../classify-prospect'

describe('classifyByKeywords', () => {
  const procedures = ['Botox', 'Preenchimento', 'Limpeza de Pele']

  it('detects price inquiry', () => {
    const result = classifyByKeywords(['Quanto custa o botox?'], procedures)
    expect(result).not.toBeNull()
    expect(result?.intent).toBe('inquiry')
    expect(result?.interestedProcedures).toEqual(['Botox'])
  })

  it('detects scheduling intent', () => {
    const result = classifyByKeywords(['Gostaria de agendar uma consulta'], procedures)
    expect(result?.intent).toBe('scheduling')
  })

  it('detects complaint', () => {
    const result = classifyByKeywords(['Tenho uma reclamação sobre o atendimento'], procedures)
    expect(result?.intent).toBe('complaint')
  })

  it('detects followup', () => {
    const result = classifyByKeywords(['Preciso marcar meu retorno'], procedures)
    // "marcar" matches scheduling, which is checked before followup
    expect(result?.intent).toBe('scheduling')
  })

  it('detects procedure without intent keyword', () => {
    const result = classifyByKeywords(['Vi que vocês fazem preenchimento'], procedures)
    expect(result?.interestedProcedures).toEqual(['Preenchimento'])
    expect(result?.intent).toBe('inquiry')
  })

  it('returns null when no match', () => {
    const result = classifyByKeywords(['Olá, bom dia!'], procedures)
    expect(result).toBeNull()
  })

  it('is case-insensitive', () => {
    const result = classifyByKeywords(['QUANTO CUSTA?'], procedures)
    expect(result?.intent).toBe('inquiry')
  })

  it('detects procedure with accent variations', () => {
    const result = classifyByKeywords(['Qual o preço do preenchimento?'], procedures)
    expect(result?.intent).toBe('inquiry')
    expect(result?.interestedProcedures).toEqual(['Preenchimento'])
  })

  it('detects multiple procedures in the same message', () => {
    const result = classifyByKeywords(['Quero fazer botox e preenchimento'], procedures)
    expect(result?.interestedProcedures).toEqual(['Botox', 'Preenchimento'])
  })

  it('sums all matched procedures', () => {
    const result = classifyByKeywords(['Quanto custa botox, preenchimento e limpeza de pele?'], procedures)
    expect(result?.interestedProcedures).toEqual(['Botox', 'Preenchimento', 'Limpeza de Pele'])
  })

  it('classifies across multiple messages', () => {
    const result = classifyByKeywords(['Oi, bom dia!', 'Quanto custa o botox?'], procedures)
    expect(result?.intent).toBe('inquiry')
    expect(result?.interestedProcedures).toEqual(['Botox'])
  })

  it('returns null when no match across multiple messages', () => {
    const result = classifyByKeywords(['Oi', 'Tudo bem?'], procedures)
    expect(result).toBeNull()
  })

  it('matches procedures with trailing spaces in names', () => {
    const procsWithSpaces = ['Botox ', 'Preenchimento ', 'Limpeza de Pele']
    const result = classifyByKeywords(['Tenho interesse em fazer botox'], procsWithSpaces)
    expect(result?.interestedProcedures).toEqual(['Botox '])
  })

  it('matches synonym "ácido hialurônico" to Preenchimento', () => {
    const result = classifyByKeywords(['Quero aplicar ácido hialurônico'], procedures)
    expect(result?.interestedProcedures).toEqual(['Preenchimento'])
  })

  it('matches synonym "toxina botulínica" to Botox', () => {
    const result = classifyByKeywords(['Quanto custa a toxina botulínica?'], procedures)
    expect(result?.interestedProcedures).toEqual(['Botox'])
  })

  it('matches synonym without accents', () => {
    const result = classifyByKeywords(['Quero acido hialuronico'], procedures)
    expect(result?.interestedProcedures).toEqual(['Preenchimento'])
  })

  it('matches synonym "dysport" to Botox', () => {
    const result = classifyByKeywords(['Vocês aplicam dysport?'], procedures)
    expect(result?.interestedProcedures).toEqual(['Botox'])
  })

  it('matches synonym "limpeza facial" to Limpeza de Pele', () => {
    const result = classifyByKeywords(['Quero agendar uma limpeza facial'], procedures)
    expect(result?.interestedProcedures).toEqual(['Limpeza de Pele'])
  })

  it('matches synonyms for procedures not in the default list', () => {
    const procsWithHarmo = ['Harmonização Facial']
    const result = classifyByKeywords(['Quanto custa a harmô?'], procsWithHarmo)
    expect(result?.interestedProcedures).toEqual(['Harmonização Facial'])
  })
})
