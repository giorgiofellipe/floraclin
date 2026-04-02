'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { cn, formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import { PartialPaymentDialog } from './partial-payment-dialog'
import {
  calculateInterest,
  getDaysOverdue,
} from '@/lib/financial/penalties'
import {
  BanknoteIcon,
  Undo2Icon,
  Loader2Icon,
  CalendarIcon,
  CheckCircle2Icon,
  ClockIcon,
  AlertTriangleIcon,
  ChevronDownIcon,
} from 'lucide-react'
import { useReversePayment } from '@/hooks/mutations/use-financial-mutations'
import { toast } from 'sonner'

interface PaymentRecord {
  id: string
  amount: string
  paymentMethod: string
  interestCovered: string
  fineCovered: string
  principalCovered: string
  paidAt: string
  recordedAt: string
  notes: string | null
}

interface Installment {
  id: string
  installmentNumber: number
  amount: string
  dueDate: string
  status: string
  paidAt: Date | null
  paymentMethod: string | null
  notes: string | null
  amountPaid?: string | null
  fineAmount?: string | null
  interestAmount?: string | null
  computedFineAmount?: number | null
  computedInterestAmount?: number | null
  appliedFineType?: string | null
  appliedFineValue?: string | null
  appliedInterestRate?: string | null
  lastFineInterestCalcAt?: string | null
  paymentRecords?: PaymentRecord[]
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'PIX',
  credit_card: 'Cartão de Crédito',
  debit_card: 'Cartão de Débito',
  cash: 'Dinheiro',
  transfer: 'Transferência',
}

function getComputedInterest(inst: Installment): number {
  if (inst.computedInterestAmount != null) return inst.computedInterestAmount
  const amount = Number(inst.amount)
  const amountPaid = Number(inst.amountPaid ?? 0)
  const rate = Number(inst.appliedInterestRate ?? 0)
  if (rate <= 0 || inst.status === 'paid') return 0
  const startDate = inst.lastFineInterestCalcAt ?? inst.dueDate
  const daysOverdue = getDaysOverdue(startDate, inst.lastFineInterestCalcAt ? 0 : 0)
  if (daysOverdue <= 0) return 0
  return calculateInterest(amount - amountPaid, daysOverdue, rate)
}

function getProgressPercent(inst: Installment): number {
  const amount = Number(inst.amount)
  if (amount <= 0) return 0
  const paid = Number(inst.amountPaid ?? 0)
  const paidFraction = inst.status === 'paid' ? 1 : paid / amount
  return Math.min(Math.round(paidFraction * 100), 100)
}

export function InstallmentTable({
  entryId,
  onPaymentComplete,
}: {
  entryId: string
  onPaymentComplete?: () => void
}) {
  const [expandedInstallmentId, setExpandedInstallmentId] = useState<string | null>(null)
  const [payDialogInstallment, setPayDialogInstallment] = useState<Installment | null>(null)
  const [reverseDialogPayment, setReverseDialogPayment] = useState<PaymentRecord | null>(null)
  const [reversalReason, setReversalReason] = useState('')
  const reversePayment = useReversePayment()

  const { data: entryData, isLoading } = useQuery({
    queryKey: ['financial', 'detail', entryId],
    queryFn: async () => {
      const res = await fetch(`/api/financial/${entryId}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar parcelas')
      }
      return res.json()
    },
    enabled: !!entryId,
  })

  const installments: Installment[] = entryData?.installments ?? []
  const entryStatus: string = entryData?.status ?? 'pending'
  const isEntryCancelled = entryStatus === 'cancelled' || entryStatus === 'renegotiated'

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
      <div className="space-y-2">
        {installments.map((inst) => {
          const fineAmt = inst.computedFineAmount ?? Number(inst.fineAmount ?? 0)
          const interestAmt = getComputedInterest(inst)
          const penaltyTotal = fineAmt + interestAmt
          const isExpanded = expandedInstallmentId === inst.id
          const hasPayments = (inst.paymentRecords?.length ?? 0) > 0
          const progress = getProgressPercent(inst)
          const isPendingOrOverdue = !isEntryCancelled && (inst.status === 'pending' || inst.status === 'overdue')
          const isPaid = inst.status === 'paid'

          const StatusIcon = isPaid ? CheckCircle2Icon : isPendingOrOverdue && penaltyTotal > 0 ? AlertTriangleIcon : ClockIcon
          const statusColor = isPaid
            ? 'text-emerald-600 bg-emerald-50'
            : isPendingOrOverdue && penaltyTotal > 0
              ? 'text-amber-700 bg-amber-50'
              : 'text-mid bg-neutral-100'

          return (
            <div key={inst.id} data-testid={`installment-${inst.id}`} className={cn(
              'rounded-md border transition-all duration-200',
              isExpanded ? 'border-sage/30 shadow-sm' : 'border-[#E8ECEF]',
            )}>
              {/* Installment row */}
              <div className="flex items-center gap-3 px-3 py-2.5">
                {/* Status icon */}
                <div className={cn('flex items-center justify-center w-7 h-7 rounded-full shrink-0', statusColor)}>
                  <StatusIcon className="h-3.5 w-3.5" />
                </div>

                {/* Installment info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-charcoal tabular-nums">
                      Parcela {inst.installmentNumber}/{installments.length}
                    </span>
                    <span className={cn(
                      'inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium',
                      isPaid ? 'bg-emerald-50 text-emerald-700' : isPendingOrOverdue ? 'bg-amber-50 text-amber-700' : 'bg-neutral-100 text-mid'
                    )}>
                      {isPaid ? 'Pago' : isPendingOrOverdue ? 'Pendente' : inst.status === 'cancelled' ? 'Cancelado' : inst.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="flex items-center gap-1 text-xs text-mid">
                      <CalendarIcon className="h-3 w-3" />
                      {formatDate(inst.dueDate)}
                    </span>
                    {/* Progress bar */}
                    <div className="flex items-center gap-1.5">
                      <div className="w-12 h-1 rounded-full bg-[#E8ECEF] overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-500',
                            progress >= 100 ? 'bg-emerald-400' : progress > 0 ? 'bg-amber-400' : 'bg-transparent'
                          )}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-mid tabular-nums">{progress}%</span>
                    </div>
                  </div>
                </div>

                {/* Penalties */}
                {penaltyTotal > 0 && isPendingOrOverdue && (
                  <div className="hidden sm:flex flex-col items-end shrink-0">
                    {fineAmt > 0 && (
                      <span className="text-[10px] text-amber-700 tabular-nums">
                        Multa {formatCurrency(fineAmt)}
                      </span>
                    )}
                    {interestAmt > 0 && (
                      <span className="text-[10px] text-amber-700 tabular-nums">
                        Juros {formatCurrency(interestAmt)}
                      </span>
                    )}
                    {inst.appliedFineValue && (
                      <span className="text-[9px] text-mid mt-0.5">
                        {inst.appliedFineValue}% + {inst.appliedInterestRate}%/mês
                      </span>
                    )}
                  </div>
                )}

                {/* Amount */}
                <span className={cn(
                  'text-sm font-semibold tabular-nums shrink-0',
                  isPendingOrOverdue && penaltyTotal > 0 ? 'text-amber-700' : 'text-charcoal'
                )}>
                  {formatCurrency(Number(inst.amount))}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {isPendingOrOverdue && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors"
                      data-testid="installment-pay"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPayDialogInstallment(inst)
                      }}
                    >
                      <BanknoteIcon className="h-3 w-3" />
                      Pagar
                    </Button>
                  )}
                  {hasPayments && (
                    <button
                      type="button"
                      className="p-1 text-mid hover:text-charcoal transition-colors"
                      onClick={() => setExpandedInstallmentId(isExpanded ? null : inst.id)}
                      aria-label={isExpanded ? 'Recolher' : 'Ver pagamentos'}
                      data-testid="installment-expand-payments"
                    >
                      <ChevronDownIcon className={cn(
                        'h-4 w-4 transition-transform duration-200',
                        isExpanded ? 'rotate-180' : 'rotate-0'
                      )} />
                    </button>
                  )}
                </div>
              </div>

              {/* Payment records */}
              {isExpanded && hasPayments && (
                <div className="border-t border-[#E8ECEF] bg-[#FAFBFA] rounded-b-md">
                  <div className="px-3 py-1.5">
                    <span className="text-[10px] uppercase tracking-[0.15em] text-mid font-medium">
                      Histórico de pagamentos
                    </span>
                  </div>
                  {inst.paymentRecords!.map((pr) => (
                    <div
                      key={pr.id}
                      className="flex items-center gap-3 px-3 py-2 border-t border-[#E8ECEF]/50 group"
                    >
                      {/* Payment dot */}
                      <div className="w-7 flex justify-center shrink-0">
                        <div className="w-1.5 h-1.5 rounded-full bg-sage/50" />
                      </div>

                      {/* Payment info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs font-medium text-charcoal tabular-nums">
                            {formatCurrency(Number(pr.amount))}
                          </span>
                          <span className="text-[10px] text-mid">
                            {formatDateTime(pr.paidAt)}
                          </span>
                          <span className="text-[10px] text-mid">
                            {pr.paymentMethod ? PAYMENT_METHOD_LABELS[pr.paymentMethod] ?? pr.paymentMethod : ''}
                          </span>
                        </div>
                        {/* Allocation breakdown */}
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-emerald-700 tabular-nums">
                            Principal {formatCurrency(Number(pr.principalCovered))}
                          </span>
                          {Number(pr.interestCovered) > 0 && (
                            <span className="text-[10px] text-amber-700 tabular-nums">
                              Juros {formatCurrency(Number(pr.interestCovered))}
                            </span>
                          )}
                          {Number(pr.fineCovered) > 0 && (
                            <span className="text-[10px] text-amber-700 tabular-nums">
                              Multa {formatCurrency(Number(pr.fineCovered))}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Reverse button */}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px] text-red-600 hover:bg-red-50 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity"
                        data-testid="payment-reverse"
                        onClick={() => {
                          setReverseDialogPayment(pr)
                          setReversalReason('')
                        }}
                      >
                        <Undo2Icon className="h-3 w-3" />
                        Estornar
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Reverse payment dialog */}
      <Dialog
        open={!!reverseDialogPayment}
        onOpenChange={(open) => { if (!open) setReverseDialogPayment(null) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Estornar Pagamento</DialogTitle>
            <DialogDescription>
              Estornar o pagamento de{' '}
              <strong>{formatCurrency(Number(reverseDialogPayment?.amount ?? 0))}</strong>
              {' '}realizado em{' '}
              <strong>{reverseDialogPayment ? formatDateTime(reverseDialogPayment.paidAt) : ''}</strong>.
              {' '}Um lançamento de saída será criado no caixa.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider font-medium text-mid">
              Motivo do estorno
            </label>
            <Textarea
              value={reversalReason}
              onChange={(e) => setReversalReason(e.target.value)}
              placeholder="Ex: PIX devolvido, pagamento registrado no paciente errado..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button
              variant="destructive"
              disabled={reversePayment.isPending}
              onClick={async () => {
                if (!reverseDialogPayment) return
                try {
                  await reversePayment.mutateAsync({
                    paymentRecordId: reverseDialogPayment.id,
                    reason: reversalReason.trim() || undefined,
                  })
                  toast.success('Pagamento estornado com sucesso')
                  setReverseDialogPayment(null)
                  onPaymentComplete?.()
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Erro ao estornar')
                }
              }}
            >
              {reversePayment.isPending ? (
                <Loader2Icon className="h-4 w-4 animate-spin" />
              ) : (
                <Undo2Icon className="h-4 w-4" />
              )}
              Confirmar Estorno
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {payDialogInstallment && (
        <PartialPaymentDialog
          open={!!payDialogInstallment}
          onOpenChange={(open) => {
            if (!open) setPayDialogInstallment(null)
          }}
          installment={{
            id: payDialogInstallment.id,
            amount: Number(payDialogInstallment.amount),
            amountPaid: Number(payDialogInstallment.amountPaid ?? 0),
            fineAmount: payDialogInstallment.computedFineAmount ?? Number(payDialogInstallment.fineAmount ?? 0),
            interestAmount: getComputedInterest(payDialogInstallment),
          }}
          onSuccess={onPaymentComplete}
        />
      )}
    </>
  )
}
