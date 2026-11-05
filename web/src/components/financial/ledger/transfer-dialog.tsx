'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/ui/date-picker'
import { MaskedInput } from '@/components/ui/masked-input'
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
import { useCreateTransfer, type FinancialAccount } from '@/hooks/queries/use-financial-accounts'
import { transferSchema } from '@/validations/financial-accounts'
import { maskCurrency, parseCurrency } from '@/lib/masks'
import { brToday } from '@/lib/dates'

export function TransferDialog({
  open,
  onOpenChange,
  accounts,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: FinancialAccount[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <TransferForm accounts={accounts} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function TransferForm({ accounts, onDone }: { accounts: FinancialAccount[]; onDone: () => void }) {
  const [fromAccountId, setFromAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(brToday())
  const [description, setDescription] = useState('')
  const createTransfer = useCreateTransfer()

  const items = Object.fromEntries(accounts.map((a) => [a.id, a.name]))

  async function handleSave() {
    const parsed = transferSchema.safeParse({
      fromAccountId,
      toAccountId,
      amount: amount ? parseCurrency(amount) : 0,
      date,
      description: description || undefined,
    })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Dados inválidos')
      return
    }
    try {
      await createTransfer.mutateAsync(parsed.data)
      toast.success('Transferência registrada')
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao registrar transferência')
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Transferir entre contas</DialogTitle>
        <DialogDescription>
          Um depósito do caixa no banco, um saque da adquirente. Sai de uma conta e entra na outra no mesmo dia,
          sem contar como receita ou despesa.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>De</Label>
            <Select items={items} value={fromAccountId} onValueChange={(v) => setFromAccountId(v ?? '')}>
              <SelectTrigger className="w-full" aria-label="Conta de origem">
                <SelectValue placeholder="Conta de origem" />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Para</Label>
            <Select items={items} value={toAccountId} onValueChange={(v) => setToAccountId(v ?? '')}>
              <SelectTrigger className="w-full" aria-label="Conta de destino">
                <SelectValue placeholder="Conta de destino" />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="transfer-amount">Valor (R$)</Label>
            <MaskedInput
              id="transfer-amount"
              mask={maskCurrency}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              inputMode="numeric"
            />
          </div>
          <div className="space-y-1">
            <Label>Data</Label>
            <DatePicker value={date} onChange={setDate} className="w-full" />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="transfer-description">Descrição (opcional)</Label>
          <Input
            id="transfer-description"
            value={description}
            maxLength={255}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Depósito do caixa"
          />
        </div>
      </div>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
        <Button onClick={handleSave} disabled={createTransfer.isPending}>
          {createTransfer.isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
          Transferir
        </Button>
      </DialogFooter>
    </>
  )
}
