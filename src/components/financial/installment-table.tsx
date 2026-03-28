'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { formatCurrency, formatDate } from '@/lib/utils'
import { getFinancialEntryAction, payInstallmentAction } from '@/actions/financial'
import { CheckIcon } from 'lucide-react'
import type { PaymentMethod } from '@/types'

interface Installment {
  id: string
  installmentNumber: number
  amount: string
  dueDate: string
  status: string
  paidAt: Date | null
  paymentMethod: string | null
  notes: string | null
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'PIX',
  credit_card: 'Cartão de Crédito',
  debit_card: 'Cartão de Débito',
  cash: 'Dinheiro',
  transfer: 'Transferência',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  overdue: 'Atrasado',
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-sage/10 text-sage',
  paid: 'bg-mint/20 text-forest',
  overdue: 'bg-amber-light text-amber-dark',
}

export function InstallmentTable({
  entryId,
  onPaymentComplete,
}: {
  entryId: string
  onPaymentComplete?: () => void
}) {
  const [installments, setInstallments] = useState<Installment[]>([])
  const [payDialogOpen, setPayDialogOpen] = useState(false)
  const [selectedInstallment, setSelectedInstallment] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [isPending, startTransition] = useTransition()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    loadInstallments()
  }, [entryId])

  function loadInstallments() {
    setIsLoading(true)
    startTransition(async () => {
      const result = await getFinancialEntryAction(entryId)
      if (result.data) {
        setInstallments(result.data.installments as Installment[])
      }
      setIsLoading(false)
    })
  }

  function handleOpenPayDialog(installmentId: string) {
    setSelectedInstallment(installmentId)
    setPaymentMethod('pix')
    setPayDialogOpen(true)
  }

  function handleConfirmPayment() {
    if (!selectedInstallment) return

    startTransition(async () => {
      const result = await payInstallmentAction(selectedInstallment, paymentMethod)
      if (result?.success) {
        setPayDialogOpen(false)
        setSelectedInstallment(null)
        loadInstallments()
        onPaymentComplete?.()
      }
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 justify-center">
        <span className="size-2 animate-pulse rounded-full bg-sage" />
        <p className="text-sm text-mid">Carregando parcelas...</p>
      </div>
    )
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="border-b border-sage/10 hover:bg-transparent">
            <TableHead className="text-[11px] uppercase tracking-wider font-medium text-mid">Parcela</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider font-medium text-mid text-right">Valor</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider font-medium text-mid">Vencimento</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider font-medium text-mid">Status</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider font-medium text-mid">Metodo</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider font-medium text-mid">Acoes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {installments.map((inst) => (
            <TableRow key={inst.id} className="border-b border-sage/5 hover:bg-petal/20 transition-colors">
              <TableCell className="text-charcoal tabular-nums">
                {inst.installmentNumber}/{installments.length}
              </TableCell>
              <TableCell className={`text-right font-medium tabular-nums ${inst.status === 'overdue' ? 'text-amber' : 'text-charcoal'}`}>
                {formatCurrency(Number(inst.amount))}
              </TableCell>
              <TableCell className="text-mid text-sm">{formatDate(inst.dueDate)}</TableCell>
              <TableCell>
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${STATUS_COLORS[inst.status] ?? 'bg-petal text-mid'}`}>
                  {STATUS_LABELS[inst.status] ?? inst.status}
                </span>
              </TableCell>
              <TableCell className="text-mid text-sm">
                {inst.paymentMethod
                  ? PAYMENT_METHOD_LABELS[inst.paymentMethod] ?? inst.paymentMethod
                  : '--'}
              </TableCell>
              <TableCell>
                {inst.status === 'pending' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full border-sage/20 text-sage hover:bg-sage/10 hover:text-forest transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleOpenPayDialog(inst.id)
                    }}
                  >
                    <CheckIcon data-icon="inline-start" />
                    Marcar como pago
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-forest">Registrar Pagamento</DialogTitle>
            <DialogDescription className="text-mid">
              Selecione o metodo de pagamento para esta parcela.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="paymentMethod" className="uppercase tracking-wider text-xs font-medium text-mid">Metodo de Pagamento</Label>
              <Select
                value={paymentMethod}
                onValueChange={(v) => setPaymentMethod((v ?? 'pix') as PaymentMethod)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string) => {
                      const labels: Record<string, string> = {
                        pix: 'PIX',
                        credit_card: 'Cartão de Crédito',
                        debit_card: 'Cartão de Débito',
                        cash: 'Dinheiro',
                        transfer: 'Transferência',
                      }
                      return labels[value] ?? value
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="credit_card">Cartão de Crédito</SelectItem>
                  <SelectItem value="debit_card">Cartão de Débito</SelectItem>
                  <SelectItem value="cash">Dinheiro</SelectItem>
                  <SelectItem value="transfer">Transferência</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" className="rounded-full border-sage/20" onClick={() => setPayDialogOpen(false)}>
              Cancelar
            </Button>
            <Button className="rounded-full bg-forest text-cream hover:bg-sage transition-colors" onClick={handleConfirmPayment} disabled={isPending}>
              {isPending ? 'Salvando...' : 'Confirmar Pagamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
