'use client'

import { useState } from 'react'
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
import { useExpenseDetail } from '@/hooks/queries/use-expenses'
import {
  usePayExpenseInstallment,
  useCancelExpense,
} from '@/hooks/mutations/use-expense-mutations'
import { ExpenseAttachmentUpload } from './expense-attachment-upload'
import { CheckIcon, XIcon, AlertTriangleIcon } from 'lucide-react'
import type { PaymentMethod } from '@/types'

interface Installment {
  id: string
  installmentNumber: number
  amount: string
  dueDate: string
  status: string
  paidAt: string | null
  paymentMethod: string | null
}

interface Attachment {
  id: string
  fileName: string
  fileSize: number
  url: string
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'PIX',
  credit_card: 'Cartao de Credito',
  debit_card: 'Cartao de Debito',
  cash: 'Dinheiro',
  transfer: 'Transferencia',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  overdue: 'Atrasado',
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-[#FFF4EF] text-amber',
  paid: 'bg-[#F0F7F1] text-sage',
  overdue: 'bg-red-50 text-red-600',
}

function getInstallmentDisplayStatus(inst: Installment): string {
  if (inst.status === 'pending' && new Date(inst.dueDate) < new Date()) return 'overdue'
  return inst.status
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ExpenseDetail({ expenseId }: { expenseId: string }) {
  const [payDialogOpen, setPayDialogOpen] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [selectedInstallment, setSelectedInstallment] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')

  const { data: expenseData, isLoading } = useExpenseDetail(expenseId)
  const payInstallment = usePayExpenseInstallment()
  const cancelExpense = useCancelExpense()

  const installments: Installment[] = expenseData?.installments ?? []
  const attachments: Attachment[] = expenseData?.attachments ?? []
  const expenseStatus: string = expenseData?.status ?? 'pending'

  function handleOpenPayDialog(installmentId: string) {
    setSelectedInstallment(installmentId)
    setPaymentMethod('pix')
    setPayDialogOpen(true)
  }

  async function handleConfirmPayment() {
    if (!selectedInstallment) return
    try {
      await payInstallment.mutateAsync({ id: selectedInstallment, paymentMethod })
      setPayDialogOpen(false)
      setSelectedInstallment(null)
    } catch {
      // error handled by mutation
    }
  }

  async function handleCancelExpense() {
    try {
      await cancelExpense.mutateAsync(expenseId)
      setCancelDialogOpen(false)
    } catch {
      // error handled by mutation
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 justify-center">
        <span className="size-2 animate-pulse rounded-full bg-sage" />
        <p className="text-sm text-mid">Carregando detalhes...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Installments table */}
      <div>
        <p className="text-[10px] uppercase tracking-[0.15em] font-medium text-[#7A7A7A] mb-3">Parcelas</p>
        <Table>
          <TableHeader>
            <TableRow className="border-b border-sage/10 hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Parcela</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] text-right">Valor</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Vencimento</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Status</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Metodo</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Pago em</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Acoes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {installments.map((inst) => {
              const displayStatus = getInstallmentDisplayStatus(inst)
              return (
                <TableRow key={inst.id} className="border-b border-[#E8ECEF] hover:bg-[#F4F6F8] transition-colors">
                  <TableCell className="text-charcoal tabular-nums">
                    {inst.installmentNumber}/{installments.length}
                  </TableCell>
                  <TableCell className={`text-right font-medium tabular-nums ${displayStatus === 'overdue' ? 'text-red-600' : 'text-charcoal'}`}>
                    {formatCurrency(Number(inst.amount))}
                  </TableCell>
                  <TableCell className="text-mid text-sm">{formatDate(inst.dueDate)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${STATUS_COLORS[displayStatus] ?? 'bg-white text-mid'}`}>
                      {STATUS_LABELS[displayStatus] ?? displayStatus}
                    </span>
                  </TableCell>
                  <TableCell className="text-mid text-sm">
                    {inst.paymentMethod
                      ? PAYMENT_METHOD_LABELS[inst.paymentMethod] ?? inst.paymentMethod
                      : '--'}
                  </TableCell>
                  <TableCell className="text-mid text-sm">
                    {inst.paidAt ? formatDate(inst.paidAt) : '--'}
                  </TableCell>
                  <TableCell>
                    {inst.status === 'pending' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleOpenPayDialog(inst.id)
                        }}
                      >
                        <CheckIcon data-icon="inline-start" />
                        Pagar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Attachments section */}
      <div>
        <p className="text-[10px] uppercase tracking-[0.15em] font-medium text-[#7A7A7A] mb-3">Anexos</p>
        <ExpenseAttachmentUpload
          expenseId={expenseId}
          attachments={attachments}
        />
      </div>

      {/* Cancel button */}
      {expenseStatus !== 'cancelled' && (
        <div className="flex justify-end pt-2 border-t border-sage/10">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setCancelDialogOpen(true)}
          >
            <XIcon data-icon="inline-start" />
            Cancelar Despesa
          </Button>
        </div>
      )}

      {/* Pay dialog */}
      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-[#2A2A2A]">Registrar Pagamento</DialogTitle>
            <DialogDescription className="text-mid">
              Selecione o metodo de pagamento para esta parcela.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="expensePaymentMethod" className="uppercase tracking-wider text-xs font-medium text-mid">Metodo de Pagamento</Label>
              <Select
                value={paymentMethod}
                onValueChange={(v) => setPaymentMethod((v ?? 'pix') as PaymentMethod)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="credit_card">Cartao de Credito</SelectItem>
                  <SelectItem value="debit_card">Cartao de Debito</SelectItem>
                  <SelectItem value="cash">Dinheiro</SelectItem>
                  <SelectItem value="transfer">Transferencia</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors" onClick={() => setPayDialogOpen(false)}>
              Cancelar
            </Button>
            <Button className="bg-forest text-cream hover:bg-sage transition-colors" onClick={handleConfirmPayment} disabled={payInstallment.isPending}>
              {payInstallment.isPending ? 'Salvando...' : 'Confirmar Pagamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel confirmation dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-[#2A2A2A] flex items-center gap-2">
              <AlertTriangleIcon className="size-5 text-red-500" />
              Cancelar Despesa
            </DialogTitle>
            <DialogDescription className="text-mid">
              Tem certeza que deseja cancelar esta despesa? Parcelas ja pagas nao serao afetadas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-2">
            <Button variant="outline" className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors" onClick={() => setCancelDialogOpen(false)}>
              Voltar
            </Button>
            <Button variant="destructive" onClick={handleCancelExpense} disabled={cancelExpense.isPending}>
              {cancelExpense.isPending ? 'Cancelando...' : 'Confirmar Cancelamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
