'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { DateRangePicker } from '@/components/ui/date-picker'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  useMoveMovements,
  useMoveMovementsPreview,
  type FinancialAccount,
  type MoveMovementsResult,
} from '@/hooks/queries/use-financial-accounts'
import { moveMovementsSchema } from '@/validations/financial-accounts'
import { formatCurrency } from '@/lib/utils'

/** What to move: the picked payments, or everything on one account. */
export type MoveTarget =
  | { mode: 'movements'; movementIds: string[]; fromAccountId?: string | null; fromAccountName?: string | null }
  | { mode: 'account' }

const payments = (n: number) => (n === 1 ? '1 pagamento' : `${n} pagamentos`)

/** "42 movidos · 3 já conciliados · 1 transferência": what happened, and what the clinic still has to act on. */
export function describeMoveResult({ moved, skippedReconciled, skippedTransfers }: MoveMovementsResult): string {
  const parts = [moved === 1 ? '1 movido' : `${moved} movidos`]
  if (skippedReconciled) parts.push(skippedReconciled === 1 ? '1 já conciliado' : `${skippedReconciled} já conciliados`)
  if (skippedTransfers) parts.push(skippedTransfers === 1 ? '1 transferência' : `${skippedTransfers} transferências`)
  return parts.join(' · ')
}

export function MoveMovementsDialog({
  open,
  onOpenChange,
  accounts,
  target,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Active accounts only, the legacy one included (it can only be a source). */
  accounts: FinancialAccount[]
  target: MoveTarget | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && target && <MoveForm accounts={accounts} target={target} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function MoveForm({
  accounts,
  target,
  onDone,
}: {
  accounts: FinancialAccount[]
  target: MoveTarget
  onDone: () => void
}) {
  const bulk = target.mode === 'account'
  const [fromAccountId, setFromAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [result, setResult] = useState<MoveMovementsResult | null>(null)
  const move = useMoveMovements()

  const sourceId = bulk ? fromAccountId : (target.fromAccountId ?? '')
  const sourceName =
    target.mode === 'movements' ? (target.fromAccountName ?? accounts.find((a) => a.id === sourceId)?.name) : undefined
  // Payments can leave the legacy account but never land on it.
  const items = Object.fromEntries(
    accounts.filter((a) => a.id !== sourceId && a.kind !== 'legacy').map((a) => [a.id, a.name]),
  )
  const fromItems = Object.fromEntries(accounts.map((a) => [a.id, a.name]))

  const parsed = moveMovementsSchema.safeParse(
    bulk
      ? { toAccountId, fromAccountId, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }
      : { toAccountId, movementIds: target.mode === 'movements' ? target.movementIds : undefined },
  )
  // The bulk move shows what it would do before it does it.
  const preview = useMoveMovementsPreview(bulk && parsed.success ? parsed.data : null)
  const counted = preview.data?.data

  function changeSource(id: string) {
    setFromAccountId(id)
    // The old destination may be the new source, or simply no longer what was meant.
    setToAccountId('')
  }

  async function handleSave() {
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Dados inválidos')
      return
    }
    try {
      const { data } = await move.mutateAsync(parsed.data)
      if (bulk) {
        setResult(data)
        return
      }
      if (data.moved === 0) toast.error('O pagamento não foi movido: desfaça a conciliação para trocar a conta')
      else toast.success('Pagamento movido')
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao mover pagamentos')
    }
  }

  if (result) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{result.moved === 0 ? 'Nenhum pagamento movido' : 'Pagamentos movidos'}</DialogTitle>
        </DialogHeader>
        <div role="status" aria-live="polite" className="space-y-1" data-testid="move-result">
          <p className="text-sm font-medium text-charcoal">{describeMoveResult(result)}</p>
          {result.skippedReconciled > 0 && (
            <p className="text-xs text-mid">
              Os já conciliados ficaram na conta de origem. Desfaça a conciliação no extrato e mova de novo.
            </p>
          )}
          {result.skippedTransfers > 0 && (
            <p className="text-xs text-mid">Transferências entre contas não são pagamentos e não são movidas.</p>
          )}
        </div>
        <DialogFooter>
          <Button autoFocus onClick={onDone}>Fechar</Button>
        </DialogFooter>
      </>
    )
  }

  const bulkReady = bulk && parsed.success && counted !== undefined && !preview.isFetching
  const saveLabel = bulk
    ? bulkReady
      ? `Mover ${payments(counted.moved)} (${formatCurrency(Number(counted.total))})`
      : 'Mover pagamentos'
    : 'Mover pagamento'

  return (
    <>
      <DialogHeader>
        <DialogTitle>{bulk ? 'Mover pagamentos entre contas' : 'Trocar conta do pagamento'}</DialogTitle>
        <DialogDescription>
          {bulk
            ? 'Corrige pagamentos registrados na conta errada. O valor e a data não mudam, só a conta onde o dinheiro caiu. Pagamentos já conciliados com o extrato ficam de fora.'
            : 'Corrige a conta onde o dinheiro caiu. O valor e a data não mudam. Se o pagamento já foi conciliado com o extrato, desfaça a conciliação antes.'}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {bulk ? (
          <div className="space-y-1">
            <Label>De</Label>
            <Select items={fromItems} value={fromAccountId} onValueChange={(v) => changeSource(v ?? '')}>
              <SelectTrigger className="w-full" aria-label="Conta de origem">
                <SelectValue placeholder="Conta de origem" />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>
        ) : (
          <div className="space-y-1">
            <Label>Conta atual</Label>
            <p className="text-sm text-charcoal" data-testid="move-current-account">
              {sourceName ?? '—'}
            </p>
          </div>
        )}
        <div className="space-y-1">
          <Label>Para</Label>
          <Select items={items} value={toAccountId} onValueChange={(v) => setToAccountId(v ?? '')}>
            <SelectTrigger className="w-full" aria-label="Conta de destino">
              <SelectValue placeholder="Conta de destino" />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>
        {bulk && (
          <div className="space-y-1">
            <Label>Período (opcional)</Label>
            <DateRangePicker fluid dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} />
            <p className="text-xs text-mid">Sem período, todos os pagamentos da conta de origem são movidos.</p>
          </div>
        )}
        {bulk && parsed.success && (
          <div role="status" aria-live="polite" className="rounded-md bg-[#F4F6F8] px-3 py-2 text-xs" data-testid="move-preview">
            {preview.isError ? (
              <span className="text-red-600">Não foi possível contar os pagamentos. Tente de novo.</span>
            ) : !bulkReady ? (
              <span className="text-mid">Contando pagamentos…</span>
            ) : counted.moved === 0 ? (
              <span className="text-charcoal">Nenhum pagamento para mover{skippedNote(counted)}.</span>
            ) : (
              <span className="text-charcoal">
                {payments(counted.moved)} somando {formatCurrency(Number(counted.total))} vão para a conta de destino
                {skippedNote(counted)}.
              </span>
            )}
          </div>
        )}
      </div>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
        <Button
          onClick={handleSave}
          disabled={move.isPending || !toAccountId || (bulk && (!bulkReady || counted.moved === 0))}
        >
          {move.isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
          {saveLabel}
        </Button>
      </DialogFooter>
    </>
  )
}

function skippedNote({ skippedReconciled, skippedTransfers }: MoveMovementsResult): string {
  const parts: string[] = []
  if (skippedReconciled) parts.push(skippedReconciled === 1 ? '1 já conciliado fica de fora' : `${skippedReconciled} já conciliados ficam de fora`)
  if (skippedTransfers) parts.push(skippedTransfers === 1 ? '1 transferência fica de fora' : `${skippedTransfers} transferências ficam de fora`)
  return parts.length ? ` (${parts.join('; ')})` : ''
}
