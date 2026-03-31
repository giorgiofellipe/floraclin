'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { cn, formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import { PenaltyBadge } from './penalty-badge'
import { PartialPaymentDialog } from './partial-payment-dialog'
import {
  calculateInterest,
  getDaysOverdue,
  type InstallmentState,
} from '@/lib/financial/penalties'
import { ChevronDownIcon, ChevronRightIcon, BanknoteIcon } from 'lucide-react'

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
  computedInterestAmount?: number | null
  appliedFineType?: string | null
  appliedFineValue?: string | null
  appliedInterestRate?: string | null
  lastFineInterestCalcAt?: string | null
  paymentRecords?: PaymentRecord[]
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
  cancelled: 'Cancelado',
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-[#FFF4EF] text-amber',
  paid: 'bg-[#F0F7F1] text-sage',
  overdue: 'bg-[#FFF4EF] text-amber-dark',
  cancelled: 'bg-white text-mid',
}

function getComputedInterest(inst: Installment): number {
  if (inst.computedInterestAmount != null) return inst.computedInterestAmount
  const amount = Number(inst.amount)
  const amountPaid = Number(inst.amountPaid ?? 0)
  const rate = Number(inst.appliedInterestRate ?? 0)
  if (rate <= 0 || inst.status === 'paid') return 0
  const startDate = inst.lastFineInterestCalcAt ?? inst.dueDate
  const graceDays = inst.lastFineInterestCalcAt ? 0 : 0
  const daysOverdue = getDaysOverdue(startDate, graceDays)
  if (daysOverdue <= 0) return 0
  return calculateInterest(amount - amountPaid, daysOverdue, rate)
}

function getProgressPercent(inst: Installment): number {
  const amount = Number(inst.amount)
  const fineAmount = Number(inst.fineAmount ?? 0)
  const interestAmount = getComputedInterest(inst)
  const total = amount + fineAmount + interestAmount
  if (total <= 0) return 0
  const paid = Number(inst.amountPaid ?? 0)
  // amountPaid is principal only, but for progress we compare total paid
  // from payment records against total due. Approximate from principal progress.
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
            <TableHead className="w-8" />
            <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Parcela</TableHead>
            <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] text-right">Valor</TableHead>
            <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Progresso</TableHead>
            <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Vencimento</TableHead>
            <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Status</TableHead>
            <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Encargos</TableHead>
            <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Acoes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {installments.map((inst) => {
            const fineAmt = Number(inst.fineAmount ?? 0)
            const interestAmt = getComputedInterest(inst)
            const isExpanded = expandedInstallmentId === inst.id
            const hasPayments = (inst.paymentRecords?.length ?? 0) > 0
            const progress = getProgressPercent(inst)
            const isPendingOrOverdue = inst.status === 'pending' || inst.status === 'overdue'

            return (
              <TableRow key={inst.id} className={cn('border-b border-[#E8ECEF] transition-colors', isExpanded && 'bg-[#F4F6F8]')}>
                <TableCell>
                  {hasPayments && (
                    <button
                      type="button"
                      className="text-mid hover:text-charcoal transition-colors p-1"
                      onClick={() => setExpandedInstallmentId(isExpanded ? null : inst.id)}
                      aria-label={isExpanded ? 'Recolher historico' : 'Expandir historico'}
                    >
                      {isExpanded ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
                    </button>
                  )}
                </TableCell>
                <TableCell className="text-charcoal tabular-nums">
                  {inst.installmentNumber}/{installments.length}
                </TableCell>
                <TableCell className={cn('text-right font-medium tabular-nums', isPendingOrOverdue && (fineAmt > 0 || interestAmt > 0) ? 'text-amber-700' : 'text-charcoal')}>
                  {formatCurrency(Number(inst.amount))}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 rounded-full bg-[#E8ECEF] overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all', progress >= 100 ? 'bg-sage' : progress > 0 ? 'bg-amber-400' : 'bg-transparent')}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="text-xs text-mid tabular-nums">{progress}%</span>
                  </div>
                </TableCell>
                <TableCell className="text-mid text-sm">{formatDate(inst.dueDate)}</TableCell>
                <TableCell>
                  <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium', STATUS_COLORS[inst.status] ?? 'bg-white text-mid')}>
                    {STATUS_LABELS[inst.status] ?? inst.status}
                  </span>
                </TableCell>
                <TableCell>
                  <PenaltyBadge
                    fineAmount={fineAmt}
                    interestAmount={interestAmt}
                    isPaid={inst.status === 'paid'}
                  />
                  {inst.appliedFineValue && isPendingOrOverdue && (
                    <span className="block text-[10px] text-mid mt-0.5">
                      Multa: {inst.appliedFineValue}% | Juros: {inst.appliedInterestRate}%/mes
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {isPendingOrOverdue && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPayDialogInstallment(inst)
                      }}
                    >
                      <BanknoteIcon data-icon="inline-start" />
                      Registrar Pagamento
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )
          })}

          {/* Expanded payment records */}
          {installments.map((inst) => {
            if (expandedInstallmentId !== inst.id || !inst.paymentRecords?.length) return null
            return inst.paymentRecords.map((pr) => (
              <TableRow key={pr.id} className="bg-[#FAFBFC] border-b border-[#E8ECEF]/50">
                <TableCell />
                <TableCell colSpan={2} className="text-xs text-mid">
                  Pagamento em {formatDateTime(pr.paidAt)}
                  <span className="ml-2 text-charcoal font-medium tabular-nums">{formatCurrency(Number(pr.amount))}</span>
                </TableCell>
                <TableCell colSpan={2} className="text-xs text-mid">
                  <span className="text-amber-700">Juros {formatCurrency(Number(pr.interestCovered))}</span>
                  {' | '}
                  <span className="text-amber-700">Multa {formatCurrency(Number(pr.fineCovered))}</span>
                  {' | '}
                  <span className="text-forest">Principal {formatCurrency(Number(pr.principalCovered))}</span>
                </TableCell>
                <TableCell className="text-xs text-mid">
                  {pr.paymentMethod ? PAYMENT_METHOD_LABELS[pr.paymentMethod] ?? pr.paymentMethod : '--'}
                </TableCell>
                <TableCell />
                <TableCell className="text-xs text-mid">{pr.notes ?? ''}</TableCell>
              </TableRow>
            ))
          })}
        </TableBody>
      </Table>

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
            fineAmount: Number(payDialogInstallment.fineAmount ?? 0),
            interestAmount: getComputedInterest(payDialogInstallment),
          }}
          onSuccess={onPaymentComplete}
        />
      )}
    </>
  )
}
