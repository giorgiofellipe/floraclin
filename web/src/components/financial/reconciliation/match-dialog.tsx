'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { MaskedInput } from '@/components/ui/masked-input'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatCurrency } from '@/lib/utils'
import { maskCurrency, unmask } from '@/lib/masks'
import {
  useAllocateLine,
  useMatchCandidates,
  type StatementLineView,
} from '@/hooks/queries/use-bank-reconciliation'

const brDay = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso))

const toCents = (masked: string) => parseInt(unmask(masked) || '0', 10)

export function MatchDialog({ line, onClose }: { line: StatementLineView | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(line)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">{line && <MatchForm line={line} onClose={onClose} />}</DialogContent>
    </Dialog>
  )
}

function MatchForm({ line, onClose }: { line: StatementLineView; onClose: () => void }) {
  const [search, setSearch] = useState('')
  // movementId -> amount typed (masked). Selecting a movement proposes the most it can take.
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const { data: candidates, isLoading } = useMatchCandidates(line.id, search)
  const allocate = useAllocateLine()

  const credit = line.amountCents > 0
  const lineRemaining = Math.abs(line.amountCents) - line.allocatedCents
  const total = Object.values(chosen).reduce((sum, masked) => sum + toCents(masked), 0)
  const overMovement = (candidates ?? []).some((c) => chosen[c.id] !== undefined && toCents(chosen[c.id]) > c.remainingCents)
  const valid = total > 0 && total <= lineRemaining && !overMovement && Object.values(chosen).every((m) => toCents(m) > 0)

  function toggle(id: string, remainingCents: number, checked: boolean) {
    setChosen((current) => {
      const next = { ...current }
      if (!checked) {
        delete next[id]
        return next
      }
      const takenElsewhere = Object.values(current).reduce((sum, masked) => sum + toCents(masked), 0)
      const proposal = Math.max(0, Math.min(remainingCents, lineRemaining - takenElsewhere))
      next[id] = maskCurrency(String(proposal))
      return next
    })
  }

  async function handleSave() {
    try {
      await allocate.mutateAsync({
        lineId: line.id,
        allocations: Object.entries(chosen).map(([movementId, masked]) => ({ movementId, amountCents: toCents(masked) })),
      })
      toast.success('Lançamento conciliado')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao conciliar')
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Conciliar lançamento</DialogTitle>
        <DialogDescription>
          {line.memo} · {credit ? '+' : '-'}
          {formatCurrency(Math.abs(line.amountCents) / 100)} · falta conciliar {formatCurrency(lineRemaining / 100)}.
          Um crédito pode cobrir várias movimentações (como repasses de cartão), e vários créditos podem cobrir um pagamento.
          Conciliar não altera o pagamento nem a parcela.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por descrição" aria-label="Buscar movimentação" />

        <div className="max-h-72 space-y-1 overflow-y-auto" data-testid="match-candidates">
          {isLoading && <Loader2Icon className="mx-auto h-4 w-4 animate-spin text-mid" />}
          {candidates && candidates.length === 0 && (
            <p className="py-4 text-center text-sm text-mid">Nenhuma movimentação disponível nesta conta.</p>
          )}
          {candidates?.map((c) => {
            const picked = chosen[c.id] !== undefined
            return (
              <div key={c.id} className="flex items-center gap-3 rounded-md border border-[#E8ECEF] p-2 text-sm">
                <Checkbox
                  checked={picked}
                  onCheckedChange={(v) => toggle(c.id, c.remainingCents, Boolean(v))}
                  aria-label={`Escolher ${c.description}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{c.description}</div>
                  <div className="text-xs text-mid">
                    {brDay(c.movementDate)} · disponível {formatCurrency(c.remainingCents / 100)}
                    {c.dayDistance > 0 && ` · ${c.dayDistance} dia(s) de diferença`}
                    {c.reversalPair && ' · pagamento estornado ou estorno'}
                  </div>
                </div>
                {picked && (
                  <MaskedInput
                    className="w-28"
                    mask={maskCurrency}
                    value={chosen[c.id]}
                    onChange={(e) => setChosen((current) => ({ ...current, [c.id]: e.target.value }))}
                    inputMode="numeric"
                    aria-label={`Valor de ${c.description}`}
                  />
                )}
              </div>
            )
          })}
        </div>

        <p className={total > lineRemaining || overMovement ? 'text-sm text-red-600' : 'text-sm text-mid'}>
          Total escolhido: {formatCurrency(total / 100)} de {formatCurrency(lineRemaining / 100)}
          {total > lineRemaining && ' — maior que o lançamento'}
          {overMovement && ' — maior que o disponível em uma movimentação'}
        </p>
      </div>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
        <Button onClick={handleSave} disabled={!valid || allocate.isPending}>
          {allocate.isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
          Conciliar
        </Button>
      </DialogFooter>
    </>
  )
}
