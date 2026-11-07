import { describe, expect, it } from 'vitest'
import { rankMatchCandidates } from '../reconciliation-matching'

const statement = { memo: 'PIX RECEBIDO MARIA JOSÉ SILVA', remainingCents: 25000, allocatedCents: 0, suspectedDuplicate: false }
const candidate = (over = {}) => ({ id: 'a', description: 'Pagamento Maria Jose Silva', amount: '250.00', remainingCents: 25000, dayDistance: 0, reversalPair: false, ...over })

describe('explainable reconciliation ranking', () => {
  it('ranks the payer text above an identical amount/date from another payer', () => {
    const ranked = rankMatchCandidates(statement, [candidate({ id: 'wrong', description: 'Pagamento Ana Costa' }), candidate()])
    expect(ranked[0]).toMatchObject({ id: 'a', score: 100, confidence: 'high', suggested: true })
    expect(ranked[0].reasons).toEqual(expect.arrayContaining([{ code: 'similar_description', label: 'Descrição semelhante' }, { code: 'exact_available_amount', label: 'Mesmo valor disponível' }]))
    expect(ranked[1].suggested).toBe(false)
  })

  it('normalizes accents, case and punctuation without relying on generic banking words or initials', () => {
    expect(rankMatchCandidates({ ...statement, memo: 'PIX: María, JOSÉ Silva!!!' }, [candidate()])[0].suggested).toBe(true)
    for (const memo of ['PIX RECEBIDO', 'Pagamento 1/3', 'M Silva', 'Silva', 'TED TRANSFERENCIA', 'Pagamento no cartão crédito']) {
      const [ranked] = rankMatchCandidates({ ...statement, memo }, [candidate()])
      expect(ranked.suggested, memo).toBe(false)
      expect(ranked.confidence).not.toBe('high')
    }
  })

  it('does not confuse a shared given name or surname with a full description match', () => {
    const [ranked] = rankMatchCandidates(statement, [candidate({ description: 'Pagamento Maria Ana Costa' })])
    expect(ranked.score).toBe(75)
    expect(ranked.suggested).toBe(false)
    expect(rankMatchCandidates({ ...statement, memo: 'Pagamento no cartão crédito' }, [candidate({ description: 'Crédito no cartão' })])[0].suggested).toBe(false)
  })

  it('keeps ties deterministic and unselected regardless of input order', () => {
    const a = candidate({ id: 'a' }), b = candidate({ id: 'b' })
    for (const input of [[a, b], [b, a]]) {
      const ranked = rankMatchCandidates(statement, input)
      expect(ranked.map((r) => r.id)).toEqual(['a', 'b'])
      expect(ranked.every((r) => !r.suggested && r.confidence !== 'high')).toBe(true)
      expect(ranked[0].reasons).toContainEqual({ code: 'ambiguous', label: 'Conferir alternativas' })
    }
  })

  it('requires a 15-point lead over a close second', () => {
    expect(rankMatchCandidates(statement, [candidate(), candidate({ id: 'b', dayDistance: 1 })])[0].suggested).toBe(false)
    expect(rankMatchCandidates(statement, [candidate(), candidate({ id: 'b', dayDistance: 4 })])[0].suggested).toBe(true)
  })

  it('accounts for settlement delays but does not invent fees or amount tolerances', () => {
    expect(rankMatchCandidates(statement, [candidate({ dayDistance: 3 })])[0]).toMatchObject({ score: 90, suggested: true })
    expect(rankMatchCandidates(statement, [candidate({ dayDistance: 4 })])[0].suggested).toBe(false)
    const [near] = rankMatchCandidates(statement, [candidate({ amount: '250.01', remainingCents: 25001 })])
    expect(near.suggested).toBe(false)
    expect(near.reasons).not.toContainEqual(expect.objectContaining({ code: 'exact_available_amount' }))
  })

  it('keeps reversal, combined and partially allocated balances manual', () => {
    for (const c of [candidate({ reversalPair: true }), candidate({ remainingCents: 15000 }), candidate({ amount: '300.00' })]) {
      expect(rankMatchCandidates(statement, [c])[0]).toMatchObject({ suggested: false, confidence: 'low' })
    }
    expect(rankMatchCandidates({ ...statement, allocatedCents: 1000 }, [candidate()])[0].suggested).toBe(false)
    expect(rankMatchCandidates({ ...statement, suspectedDuplicate: true }, [candidate()])[0].suggested).toBe(false)
  })

  it('scores the complete retrieved pool before returning 50, and suppresses preselection for truncated pools/search', () => {
    const input = Array.from({ length: 75 }, (_, n) => candidate({ id: `other-${n}`, description: 'Ana Costa' }))
    input.push(candidate({ id: 'best' }))
    const ranked = rankMatchCandidates(statement, input)
    expect(ranked).toHaveLength(50)
    expect(ranked[0]).toMatchObject({ id: 'best', suggested: true })
    expect(rankMatchCandidates(statement, input, { truncated: true })[0]).toMatchObject({ suggested: false, confidence: 'low' })
    expect(rankMatchCandidates(statement, input, { manualSearch: true })[0].suggested).toBe(false)
  })

  it('returns an empty list when there are no eligible movements', () => {
    expect(rankMatchCandidates(statement, [])).toEqual([])
  })
})
