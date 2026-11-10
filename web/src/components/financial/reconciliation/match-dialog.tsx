'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangleIcon, CheckIcon, Loader2Icon, SparklesIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MaskedInput } from '@/components/ui/masked-input'
import { Dialog, DialogClose } from '@/components/ui/dialog'
import { cn, formatCurrency } from '@/lib/utils'
import { formatBrDate } from '@/lib/dates'
import { maskCurrency, unmask } from '@/lib/masks'
import { useAllocateLine, useMatchCandidates, type MatchCandidateView, type StatementLineView } from '@/hooks/queries/use-bank-reconciliation'
import { ReconciliationDialogContent } from './reconciliation-dialog'

const toCents = (masked: string) => parseInt(unmask(masked) || '0', 10)
const money = (cents: number) => formatCurrency(cents / 100)
const WARNING_REASONS = new Set(['partial', 'reversal', 'ambiguous', 'limited', 'suspected_duplicate'])

export function MatchDialog({ line, onClose }: { line: StatementLineView | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(line)} onOpenChange={(open) => !open && onClose()}>
      <ReconciliationDialogContent title="Conciliar lançamento" description="Confira as sugestões e escolha os valores antes de confirmar.">
        {line && <MatchForm key={line.id} line={line} onClose={onClose} />}
      </ReconciliationDialogContent>
    </Dialog>
  )
}

function MatchForm({ line, onClose }: { line: StatementLineView; onClose: () => void }) {
  const initial = useMatchCandidates(line.id, '')
  // Mount once after the first default response. Later refetches never reinitialize user choices.
  if (initial.data) return <MatchEditor line={line} initialCandidates={initial.data.candidates} initialRemaining={initial.data.remainingCents} onClose={onClose} />
  return (
    <div className="min-h-0 overflow-y-auto p-4" aria-live="polite">
      {initial.error ? <div role="alert"><p>Não foi possível buscar sugestões.</p><Button className="mt-2 min-h-11" onClick={() => initial.refetch()}>Tentar de novo</Button></div> :
        <div aria-label="Buscando sugestões" className="space-y-3">{[1, 2, 3].map((n) => <div key={n} className="h-20 animate-pulse rounded-xl bg-muted" />)}</div>}
    </div>
  )
}

type Choice = { candidate: MatchCandidateView; value: string }
function MatchEditor({ line, initialCandidates, initialRemaining, onClose }: { line: StatementLineView; initialCandidates: MatchCandidateView[]; initialRemaining: number; onClose: () => void }) {
  const [budget, setBudget] = useState(initialRemaining)
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState<Record<string, Choice>>(() => {
    const suggested = initialCandidates.find((c) => c.suggested && !c.reversalPair && c.remainingCents === initialRemaining)
    return suggested ? { [suggested.id]: { candidate: suggested, value: maskCurrency(String(initialRemaining)) } } : {}
  })
  const [saveConflict, setSaveConflict] = useState(false)
  const [showMemo, setShowMemo] = useState(false)
  const query = useMatchCandidates(line.id, search)
  const candidates = query.data?.candidates ?? []
  const lineRemaining = query.data?.remainingCents ?? budget
  const allocate = useAllocateLine()
  const choices = Object.values(chosen)
  const total = choices.reduce((sum, choice) => sum + toCents(choice.value), 0)
  const stale = saveConflict || lineRemaining !== budget || choices.some(({ candidate }) => {
    const live = candidates.find((c) => c.id === candidate.id)
    return live ? live.remainingCents !== candidate.remainingCents : Boolean(query.data && !search.trim())
  })
  const overMovement = choices.some(({ candidate, value }) => toCents(value) > candidate.remainingCents)
  const valid = total > 0 && total <= lineRemaining && !overMovement && !stale && !query.error && !query.isFetching && choices.every((c) => toCents(c.value) > 0)
  // Selected cards remain visible during manual search, even when they aren't in that response.
  const visible = [...choices.map((c) => candidates.find((live) => live.id === c.candidate.id) ?? c.candidate), ...candidates.filter((c) => !chosen[c.id])]

  function toggle(candidate: MatchCandidateView) {
    setChosen((current) => {
      const next = { ...current }
      if (next[candidate.id]) { delete next[candidate.id]; return next }
      const taken = Object.values(current).reduce((sum, c) => sum + toCents(c.value), 0)
      const proposal = Math.min(candidate.remainingCents, lineRemaining - taken)
      if (proposal > 0) next[candidate.id] = { candidate, value: maskCurrency(String(proposal)) }
      return next
    })
  }

  function setAmount(id: string, value: string) {
    setChosen((current) => ({ ...current, [id]: { ...current[id], value } }))
  }

  async function refreshSuggestions() {
    setChosen({})
    const refreshed = await query.refetch()
    if (refreshed.data && !refreshed.error) {
      setBudget(refreshed.data.remainingCents)
      setSaveConflict(false)
    }
  }

  async function handleSave() {
    if (!valid || allocate.isPending) return
    try {
      await allocate.mutateAsync({ lineId: line.id, allocations: choices.map(({ candidate, value }) => ({ movementId: candidate.id, amountCents: toCents(value) })) })
      toast.success('Lançamento conciliado')
      onClose()
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && /^(ALLOCATION_|MOVEMENT_NOT_FOUND)/.test(String(err.code))) setSaveConflict(true)
      toast.error(err instanceof Error ? err.message : 'Erro ao conciliar')
    }
  }

  const action = choices.length > 1 ? `Conciliar ${choices.length} movimentações` : choices.length === 1 ? `Conciliar ${money(total)} com ${choices[0].candidate.description}` : 'Conciliar'
  return (
    <>
      <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-4 [overflow-wrap:anywhere]">
        <div className="min-w-0 rounded-xl bg-[#F4F6F8] p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <strong className="text-xl">{line.amountCents > 0 ? '+' : '-'}{money(Math.abs(line.amountCents))}</strong>
            <span className="text-xs text-[#6B6B6B]">{line.postedDate.split('-').reverse().join('/')}</span>
          </div>
          <p className={cn('mt-1 text-sm', !showMemo && 'line-clamp-2')}>{line.memo}</p>
          {line.memo.length > 70 && <Button variant="link" className="min-h-11 px-0" onClick={() => setShowMemo(!showMemo)}>{showMemo ? 'Ver menos' : 'Ver tudo'}</Button>}
        </div>
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium focus-visible:outline-2 focus-visible:outline-forest">Como funciona</summary>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[#6B6B6B]">
            <li>Um crédito pode cobrir várias movimentações.</li><li>Vários créditos podem cobrir um pagamento.</li><li>Conciliar não altera o pagamento nem a parcela.</li>
          </ul>
        </details>
        <Input className="min-h-11" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou descrição" aria-label="Buscar movimentação" />
        {stale && <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Os dados mudaram. Atualize as sugestões.
          <Button variant="outline" className="mt-2 min-h-11" onClick={refreshSuggestions} disabled={query.isFetching}>Atualizar sugestões</Button>
        </div>}
        {query.error && <div role="alert"><p>Não foi possível buscar sugestões.</p><Button className="mt-2 min-h-11" onClick={() => query.refetch()}>Tentar de novo</Button></div>}
        {query.isFetching && <p role="status" className="text-sm text-[#6B6B6B]">Buscando sugestões…</p>}
        {!query.isFetching && !query.error && !candidates.some((c) => c.confidence !== 'low') && <p className="text-sm text-[#6B6B6B]">Nenhuma sugestão segura. Busque manualmente ou confira as movimentações abaixo.</p>}
        <div className="space-y-3" data-testid="match-candidates">
          {!query.isFetching && !query.error && candidates.length === 0 && <p className="py-4 text-center text-sm text-[#6B6B6B]">Nenhuma movimentação encontrada. Tente buscar por nome ou descrição.</p>}
          {visible.map((c) => {
            const picked = Boolean(chosen[c.id])
            const covered = !picked && total >= lineRemaining
            return (
              <div key={c.id} className={cn('min-w-0 rounded-xl border border-[#E8ECEF]', c.suggested && 'border-2 border-forest')}>
                <button type="button" role="checkbox" aria-checked={picked} aria-label={`Escolher ${c.description}`} disabled={covered || allocate.isPending} onClick={() => toggle(c)}
                  className="flex min-h-16 w-full min-w-0 items-start gap-3 rounded-xl p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest disabled:opacity-60">
                  <span aria-hidden="true" className={cn('mt-1 flex size-6 shrink-0 items-center justify-center rounded border', picked && 'border-forest bg-forest text-white')}>{picked && <CheckIcon className="size-4" />}</span>
                  <span className="min-w-0 flex-1 space-y-2">
                    {c.suggested && <span className="flex items-center gap-1 text-xs font-medium text-forest"><SparklesIcon className="size-3 shrink-0" />Sugerido · confiança alta</span>}
                    {!c.suggested && c.confidence === 'medium' && <span className="block text-xs text-[#6B6B6B]">Confiança média · confira os motivos</span>}
                    <span className="block text-sm font-medium">{c.description}</span>
                    <span className="flex flex-wrap justify-between gap-2 text-xs text-[#6B6B6B]"><span>{formatBrDate(c.movementDate)}</span><span>Disponível {money(c.remainingCents)}</span></span>
                    <span className="flex flex-wrap gap-1">
                      {(c.reasons ?? []).slice(0, 3).map((r) => <span key={r.code} className="inline-flex items-center gap-1 rounded bg-[#F4F6F8] px-2 py-1 text-xs text-[#6B6B6B]">{WARNING_REASONS.has(r.code) ? <AlertTriangleIcon className="size-3 shrink-0" /> : <CheckIcon className="size-3 shrink-0" />}{r.label}</span>)}
                    </span>
                    {covered && <span className="block text-xs text-[#6B6B6B]">Já coberto</span>}
                    {c.reversalPair && <span className="flex items-center gap-1 text-xs text-amber-800"><AlertTriangleIcon className="size-3 shrink-0" />Pagamento estornado ou estorno</span>}
                  </span>
                </button>
                {(c.reasons?.length ?? 0) > 3 && <details className="px-3 pb-3 text-xs text-[#6B6B6B]"><summary className="flex min-h-11 cursor-pointer items-center">+{c.reasons.length - 3} motivos</summary>{c.reasons.slice(3).map((r) => <p key={r.code}>{r.label}</p>)}</details>}
                {picked && <div className="min-w-0 space-y-1 border-t p-3">
                  <label className="text-xs text-[#6B6B6B]" htmlFor={`amount-${c.id}`}>Valor a conciliar (R$)</label>
                  <div className="flex min-w-0 gap-2">
                    <MaskedInput id={`amount-${c.id}`} className="min-h-11 min-w-0 flex-1" mask={maskCurrency} value={chosen[c.id].value} onChange={(e) => setAmount(c.id, e.target.value)} inputMode="decimal" aria-label={`Valor de ${c.description}`} disabled={allocate.isPending} />
                    <Button variant="outline" className="min-h-11" disabled={allocate.isPending} onClick={() => setAmount(c.id, maskCurrency(String(Math.max(0, Math.min(c.remainingCents, lineRemaining - total + toCents(chosen[c.id].value))))))}>Usar tudo</Button>
                  </div>
                </div>}
              </div>
            )
          })}
        </div>
      </div>
      <div className="shrink-0 space-y-2 border-t bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p aria-live="polite" className={cn('text-sm', total > lineRemaining || overMovement ? 'text-red-700' : 'text-[#6B6B6B]')}>Escolhido {money(total)} de {money(lineRemaining)}{total > lineRemaining ? ' — maior que o lançamento' : overMovement ? ' — maior que o disponível' : total > 0 && total < lineRemaining ? ` · falta ${money(lineRemaining - total)} para cobrir tudo` : ''}</p>
        <div className="h-1 overflow-hidden rounded bg-muted" aria-hidden="true"><div className="h-full bg-forest" style={{ width: `${Math.min(100, total / Math.max(1, lineRemaining) * 100)}%` }} /></div>
        <Button className="h-auto min-h-11 w-full whitespace-normal [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2" onClick={handleSave} disabled={!valid || allocate.isPending}>
          {allocate.isPending && <Loader2Icon className="size-4 animate-spin" />}{action}
        </Button>
        <DialogClose render={<Button variant="outline" className="min-h-11 w-full" disabled={allocate.isPending} />}>Cancelar</DialogClose>
      </div>
    </>
  )
}
