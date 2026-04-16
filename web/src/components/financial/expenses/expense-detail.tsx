'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/ui/date-picker'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { useExpenseDetail } from '@/hooks/queries/use-expenses'
import {
  usePayExpenseInstallment,
  useCancelExpense,
} from '@/hooks/mutations/use-expense-mutations'
import { ExpenseAttachmentUpload } from './expense-attachment-upload'
import { PAYMENT_METHOD_ITEMS } from '@/lib/financial/constants'
import {
  BanknoteIcon,
  XCircleIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClockIcon,
  CalendarIcon,
  Loader2Icon,
  PaperclipIcon,
} from 'lucide-react'
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

function getInstallmentDisplayStatus(inst: Installment): string {
  if (inst.status === 'pending' && new Date(inst.dueDate) < new Date()) return 'overdue'
  return inst.status
}

export function ExpenseDetail({ expenseId }: { expenseId: string }) {
  const [payDialogOpen, setPayDialogOpen] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [selectedInstallment, setSelectedInstallment] = useState<Installment | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [paidAt, setPaidAt] = useState('')

  const { data: expenseData, isLoading } = useExpenseDetail(expenseId)
  const payInstallment = usePayExpenseInstallment()
  const cancelExpense = useCancelExpense()

  const installments: Installment[] = expenseData?.installments ?? []
  const attachments: Attachment[] = expenseData?.attachments ?? []
  const expenseStatus: string = expenseData?.status ?? 'pending'
  const isEntryCancelled = expenseStatus === 'cancelled'

  function handleOpenPayDialog(inst: Installment) {
    setSelectedInstallment(inst)
    setPaymentMethod('pix')
    setPaidAt('')
    setPayDialogOpen(true)
  }

  async function handleConfirmPayment() {
    if (!selectedInstallment) return
    try {
      await payInstallment.mutateAsync({
        id: selectedInstallment.id,
        paymentMethod,
        paidAt: paidAt ? new Date(paidAt).toISOString() : undefined,
      })
      setPayDialogOpen(false)
      setSelectedInstallment(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao processar')
    }
  }

  async function handleCancelExpense() {
    try {
      await cancelExpense.mutateAsync(expenseId)
      setCancelDialogOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao processar')
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
    <div className="space-y-4">
      {/* Installment cards */}
      <div className="space-y-2">
        <span className="text-[10px] uppercase tracking-[0.15em] text-mid font-medium">
          Parcelas
        </span>
        {installments.map((inst) => {
          const displayStatus = getInstallmentDisplayStatus(inst)
          const isPaid = displayStatus === 'paid'
          const isOverdue = displayStatus === 'overdue'
          const isPending = displayStatus === 'pending'
          const canPay = !isEntryCancelled && inst.status === 'pending'

          const StatusIcon = isPaid ? CheckCircle2Icon : isOverdue ? AlertTriangleIcon : ClockIcon
          const statusColor = isPaid
            ? 'text-emerald-600 bg-emerald-50'
            : isOverdue
              ? 'text-red-700 bg-red-50'
              : 'text-mid bg-neutral-100'

          return (
            <div
              key={inst.id}
              data-testid={`expense-installment-${inst.id}`}
              className="flex items-center gap-3 rounded-md border border-[#E8ECEF] px-3 py-2.5"
            >
              {/* Status icon */}
              <div className={cn('flex items-center justify-center w-7 h-7 rounded-full shrink-0', statusColor)}>
                <StatusIcon className="h-3.5 w-3.5" />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-charcoal tabular-nums">
                    Parcela {inst.installmentNumber}/{installments.length}
                  </span>
                  <span className={cn(
                    'inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium',
                    isPaid ? 'bg-emerald-50 text-emerald-700'
                      : isOverdue ? 'bg-red-50 text-red-700'
                        : 'bg-neutral-100 text-mid'
                  )}>
                    {isPaid ? 'Pago' : isOverdue ? 'Atrasado' : isPending ? 'Pendente' : inst.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="flex items-center gap-1 text-xs text-mid">
                    <CalendarIcon className="h-3 w-3" />
                    {formatDate(inst.dueDate)}
                  </span>
                  {isPaid && inst.paidAt && (
                    <span className="text-xs text-mid">
                      Pago em {formatDate(inst.paidAt)}
                    </span>
                  )}
                  {isPaid && inst.paymentMethod && (
                    <span className="text-xs text-mid">
                      {PAYMENT_METHOD_ITEMS[inst.paymentMethod] ?? inst.paymentMethod}
                    </span>
                  )}
                </div>
              </div>

              {/* Amount */}
              <span className={cn(
                'text-sm font-semibold tabular-nums shrink-0',
                isOverdue ? 'text-red-700' : 'text-charcoal'
              )}>
                {formatCurrency(Number(inst.amount))}
              </span>

              {/* Pay button */}
              {canPay && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors shrink-0"
                  data-testid="expense-installment-pay"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleOpenPayDialog(inst)
                  }}
                >
                  <BanknoteIcon className="h-3 w-3" />
                  Pagar
                </Button>
              )}
            </div>
          )
        })}
      </div>

      {/* Attachments */}
      <div className="space-y-2">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-mid font-medium">
          <PaperclipIcon className="h-3 w-3" />
          Anexos
        </span>
        <ExpenseAttachmentUpload
          expenseId={expenseId}
          attachments={attachments}
        />
      </div>

      {/* Cancel button */}
      {!isEntryCancelled && (
        <div className="flex justify-end pt-2 border-t border-sage/10">
          <Button
            variant="ghost"
            size="sm"
            className="text-red-600 hover:bg-red-50 hover:text-red-700"
            data-testid="expense-cancel"
            onClick={() => setCancelDialogOpen(true)}
          >
            <XCircleIcon className="h-3.5 w-3.5" />
            Cancelar Despesa
          </Button>
        </div>
      )}

      {/* Pay dialog */}
      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-charcoal">Registrar Pagamento</DialogTitle>
            <DialogDescription className="text-mid">
              {selectedInstallment && (
                <>
                  Parcela {selectedInstallment.installmentNumber}/{installments.length} —{' '}
                  <strong>{formatCurrency(Number(selectedInstallment.amount))}</strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label className="uppercase tracking-wider text-xs font-medium text-mid">Método de Pagamento</Label>
              <Select
                items={PAYMENT_METHOD_ITEMS}
                value={paymentMethod}
                onValueChange={(v) => setPaymentMethod((v ?? 'pix') as PaymentMethod)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent />
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="uppercase tracking-wider text-xs font-medium text-mid">Data do pagamento (opcional)</Label>
              <DatePicker
                value={paidAt}
                onChange={(v) => setPaidAt(v)}
                placeholder="Hoje"
              />
              <p className="text-xs text-mid">Deixe em branco para usar a data de hoje.</p>
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" className="border-sage/30" onClick={() => setPayDialogOpen(false)}>
              Cancelar
            </Button>
            <Button className="bg-forest text-cream hover:bg-sage transition-colors" onClick={handleConfirmPayment} disabled={payInstallment.isPending}>
              {payInstallment.isPending ? (
                <><Loader2Icon className="h-4 w-4 animate-spin" /> Salvando...</>
              ) : 'Confirmar Pagamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel confirmation dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-charcoal flex items-center gap-2">
              <AlertTriangleIcon className="size-5 text-red-500" />
              Cancelar Despesa
            </DialogTitle>
            <DialogDescription className="text-mid">
              Tem certeza que deseja cancelar esta despesa? Parcelas já pagas não serão afetadas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-2">
            <Button variant="outline" className="border-sage/30" onClick={() => setCancelDialogOpen(false)}>
              Voltar
            </Button>
            <Button variant="destructive" onClick={handleCancelExpense} disabled={cancelExpense.isPending}>
              {cancelExpense.isPending ? (
                <><Loader2Icon className="h-4 w-4 animate-spin" /> Cancelando...</>
              ) : 'Confirmar Cancelamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
