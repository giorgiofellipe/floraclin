'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { formatCurrency } from '@/lib/utils'
import { PAYMENT_METHOD_ITEMS } from '@/lib/financial/constants'
import { useExpenseCategories } from '@/hooks/queries/use-financial-settings'
import { useCreateExpenseFromLine, type StatementLineView } from '@/hooks/queries/use-bank-reconciliation'

const METHODS = { transfer: PAYMENT_METHOD_ITEMS.transfer, pix: PAYMENT_METHOD_ITEMS.pix, debit_card: PAYMENT_METHOD_ITEMS.debit_card }

export function ExpenseFromLineDialog({ line, onClose }: { line: StatementLineView | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(line)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">{line && <ExpenseForm line={line} onClose={onClose} />}</DialogContent>
    </Dialog>
  )
}

function ExpenseForm({ line, onClose }: { line: StatementLineView; onClose: () => void }) {
  const { data: categoriesResponse } = useExpenseCategories()
  const categories: Array<{ id: string; name: string }> = categoriesResponse?.data ?? []
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState(line.memo)
  const [paymentMethod, setPaymentMethod] = useState('transfer')
  const create = useCreateExpenseFromLine()

  async function handleSave() {
    try {
      await create.mutateAsync({ lineId: line.id, categoryId, description, paymentMethod })
      toast.success('Despesa registrada e conciliada')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar a despesa')
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Criar despesa a partir do extrato</DialogTitle>
        <DialogDescription>
          Registra uma despesa paga de {formatCurrency(Math.abs(line.amountCents) / 100)} nesta conta e já a concilia com
          este lançamento. Use para tarifas e contas pagas direto no banco.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1">
          <Label>Categoria</Label>
          <Select items={Object.fromEntries(categories.map((c) => [c.id, c.name]))} value={categoryId} onValueChange={(v) => setCategoryId(v ?? '')}>
            <SelectTrigger className="w-full" aria-label="Categoria da despesa">
              <SelectValue placeholder="Escolha a categoria" />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Forma de pagamento</Label>
          <Select items={METHODS} value={paymentMethod} onValueChange={(v) => setPaymentMethod(v ?? 'transfer')}>
            <SelectTrigger className="w-full" aria-label="Forma de pagamento">
              <SelectValue />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="expense-line-description">Descrição</Label>
          <Input id="expense-line-description" value={description} maxLength={255} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
        <Button onClick={handleSave} disabled={!categoryId || !description.trim() || create.isPending}>
          {create.isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
          Criar e conciliar
        </Button>
      </DialogFooter>
    </>
  )
}
