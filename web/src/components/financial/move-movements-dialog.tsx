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
import { useMoveMovements, type FinancialAccount, type MoveMovementsResult } from '@/hooks/queries/use-financial-accounts'
import { moveMovementsSchema } from '@/validations/financial-accounts'

/** What to move: the picked payments, or everything on one account. */
export type MoveTarget =
  | { mode: 'movements'; movementIds: string[]; fromAccountId?: string | null }
  | { mode: 'account' }

export function describeMoveResult({ moved, skippedReconciled, skippedTransfers }: MoveMovementsResult): string {
  const parts = [moved === 1 ? '1 pagamento movido' : `${moved} pagamentos movidos`]
  if (skippedReconciled) parts.push(`${skippedReconciled} já conciliado(s): desfaça a conciliação para mover`)
  if (skippedTransfers) parts.push(`${skippedTransfers} transferência(s) ignorada(s)`)
  return parts.join('. ')
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
  const move = useMoveMovements()

  const sourceId = bulk ? fromAccountId : (target.fromAccountId ?? '')
  // Payments can leave the legacy account but never land on it.
  const items = Object.fromEntries(
    accounts.filter((a) => a.id !== sourceId && a.kind !== 'legacy').map((a) => [a.id, a.name]),
  )
  const fromItems = Object.fromEntries(accounts.map((a) => [a.id, a.name]))

  async function handleSave() {
    const parsed = moveMovementsSchema.safeParse(
      bulk
        ? { toAccountId, fromAccountId, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }
        : { toAccountId, movementIds: target.mode === 'movements' ? target.movementIds : undefined },
    )
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Dados inválidos')
      return
    }
    try {
      const { data } = await move.mutateAsync(parsed.data)
      if (data.moved === 0 && (data.skippedReconciled || data.skippedTransfers)) toast.error(describeMoveResult(data))
      else toast.success(describeMoveResult(data))
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao mover pagamentos')
    }
  }

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
        {bulk && (
          <div className="space-y-1">
            <Label>De</Label>
            <Select items={fromItems} value={fromAccountId} onValueChange={(v) => setFromAccountId(v ?? '')}>
              <SelectTrigger className="w-full" aria-label="Conta de origem">
                <SelectValue placeholder="Conta de origem" />
              </SelectTrigger>
              <SelectContent />
            </Select>
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
            <DateRangePicker dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} />
            <p className="text-xs text-mid">Sem período, todos os pagamentos da conta de origem são movidos.</p>
          </div>
        )}
      </div>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
        <Button onClick={handleSave} disabled={move.isPending || !toAccountId || (bulk && !fromAccountId)}>
          {move.isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
          Mover
        </Button>
      </DialogFooter>
    </>
  )
}
