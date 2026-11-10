/** Explainable ranking only: a score is not a probability or permission to reconcile. */
export interface MatchReason {
  code: 'exact_available_amount' | 'same_br_day' | 'near_br_day' | 'similar_description' | 'partial' | 'reversal' | 'ambiguous' | 'limited' | 'suspected_duplicate'
  label: string
}

export interface MatchRanking {
  score: number
  confidence: 'high' | 'medium' | 'low'
  reasons: MatchReason[]
  suggested: boolean
}

interface Candidate {
  id: string
  description: string
  remainingCents: number
  amount: string
  /** Computed in SQL using America/Sao_Paulo calendar days, never host-local dates. */
  dayDistance: number
  reversalPair: boolean
}

interface Statement {
  memo: string
  remainingCents: number
  allocatedCents: number
  suspectedDuplicate: boolean
}

// Banking boilerplate, installment numbers and one-letter initials cannot establish identity.
const BOILERPLATE = new Set(`pix ted doc pagamento pagamentos pago paga recebido recebida recebimento transferencia transferido transferida banco credito debito entrada saida repasse parcela parcelas estorno devolucao de da do das dos e para por via em cpf cnpj conta ag agencia comprovante ref referencia cartao cartoes boleto boletos dinheiro cliente paciente recebiveis venda vendas compra compras liquidacao no na nos nas`.split(' '))
function tokens(text: string): Set<string> {
  return new Set(text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .split(/[^a-z]+/).filter((t) => t.length > 1 && !BOILERPLATE.has(t)))
}

function descriptionEvidence(memo: Set<string>, description: string) {
  const other = tokens(description)
  const shared = [...memo].filter((t) => other.has(t)).length
  const coverage = Math.min(shared / Math.max(1, memo.size), shared / Math.max(1, other.size))
  return { points: shared >= 2 ? Math.round(25 * coverage) : 0, strong: shared >= 2 && coverage >= 0.8 }
}

/** Rank the retrieved pool BEFORE slicing the response. Truncated pools and manual searches never preselect. */
export function rankMatchCandidates<T extends Candidate>(
  line: Statement,
  candidates: readonly T[],
  opts: { truncated?: boolean; manualSearch?: boolean; limit?: number } = {},
): Array<T & MatchRanking> {
  const memoTokens = tokens(line.memo)
  const ranked = candidates.map((candidate) => {
    const exact = candidate.remainingCents === line.remainingCents
    const partial = !exact || line.allocatedCents > 0 || Math.round(Number(candidate.amount) * 100) !== candidate.remainingCents
    const text = descriptionEvidence(memoTokens, candidate.description)
    const days = candidate.dayDistance
    const datePoints = days === 0 ? 25 : days === 1 ? 20 : days <= 3 ? 15 : days <= 7 ? 5 : 0
    const score = Math.max(0, (exact ? 50 : 0) + datePoints + text.points - (candidate.reversalPair ? 20 : 0))
    const reasons: MatchReason[] = []
    if (exact) reasons.push({ code: 'exact_available_amount', label: 'Mesmo valor disponível' })
    if (days === 0) reasons.push({ code: 'same_br_day', label: 'Mesma data' })
    else reasons.push({ code: 'near_br_day', label: `${days} ${days === 1 ? 'dia' : 'dias'} de diferença` })
    if (text.strong) reasons.push({ code: 'similar_description', label: 'Descrição semelhante' })
    if (partial) reasons.push({ code: 'partial', label: 'Conferir valor parcial' })
    if (candidate.reversalPair) reasons.push({ code: 'reversal', label: 'Pagamento estornado ou estorno' })
    if (line.suspectedDuplicate) reasons.push({ code: 'suspected_duplicate', label: 'Possível duplicado' })
    if (opts.truncated) reasons.push({ code: 'limited', label: 'Refine a busca' })
    const eligible = !partial && !candidate.reversalPair && !line.suspectedDuplicate && !opts.truncated
    const ranking: MatchRanking = { score, confidence: eligible && score >= 65 ? 'medium' : 'low', reasons, suggested: false }
    return { candidate, ranking, highEligible: eligible && days <= 3 && text.strong && score >= 85 }
  }).sort((a, b) => b.ranking.score - a.ranking.score || Number(a.candidate.reversalPair) - Number(b.candidate.reversalPair) || a.candidate.dayDistance - b.candidate.dayDistance || a.candidate.id.localeCompare(b.candidate.id))

  const top = ranked[0]
  if (top?.highEligible) {
    if (!ranked[1] || top.ranking.score - ranked[1].ranking.score >= 15) {
      top.ranking.confidence = 'high'
      top.ranking.suggested = !opts.manualSearch
    } else {
      top.ranking.reasons.push({ code: 'ambiguous', label: 'Conferir alternativas' })
    }
  }
  return ranked.slice(0, opts.limit ?? 50).map(({ candidate, ranking }) => ({ ...candidate, ...ranking }))
}
