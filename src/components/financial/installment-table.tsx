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
import { Badge } from '@/components/ui/badge'
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

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  paid: 'default',
  overdue: 'destructive',
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
    return <p className="text-sm text-muted-foreground py-4">Carregando parcelas...</p>
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Parcela</TableHead>
            <TableHead>Valor</TableHead>
            <TableHead>Vencimento</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Método</TableHead>
            <TableHead>Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {installments.map((inst) => (
            <TableRow key={inst.id}>
              <TableCell>
                {inst.installmentNumber}/{installments.length}
              </TableCell>
              <TableCell>{formatCurrency(Number(inst.amount))}</TableCell>
              <TableCell>{formatDate(inst.dueDate)}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANTS[inst.status] ?? 'outline'}>
                  {STATUS_LABELS[inst.status] ?? inst.status}
                </Badge>
              </TableCell>
              <TableCell>
                {inst.paymentMethod
                  ? PAYMENT_METHOD_LABELS[inst.paymentMethod] ?? inst.paymentMethod
                  : '—'}
              </TableCell>
              <TableCell>
                {inst.status === 'pending' && (
                  <Button
                    size="sm"
                    variant="outline"
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
            <DialogTitle>Registrar Pagamento</DialogTitle>
            <DialogDescription>
              Selecione o método de pagamento para esta parcela.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="paymentMethod">Método de Pagamento</Label>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmPayment} disabled={isPending}>
              {isPending ? 'Salvando...' : 'Confirmar Pagamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
