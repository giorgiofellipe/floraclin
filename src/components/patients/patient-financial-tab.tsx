'use client'

import { useMemo, useState } from 'react'
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
import { formatCurrency, formatDate } from '@/lib/utils'
import { useFinancialEntries } from '@/hooks/queries/use-financial'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/hooks/queries/query-keys'
import { InstallmentTable } from '@/components/financial/installment-table'
import { PenaltyBadge } from '@/components/financial/penalty-badge'
import { PaymentForm } from '@/components/financial/payment-form'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  Plus,
  Wallet,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react'

interface RenegotiationLink {
  originalEntryId: string
  newEntryId: string
  newEntryDescription?: string
  originalEntryDescription?: string
}

interface FinancialEntry {
  id: string
  patientId: string
  patientName: string
  description: string
  totalAmount: string
  installmentCount: number
  status: string
  notes: string | null
  createdAt: Date
  paidInstallments: number
  totalFineAmount?: number
  totalInterestAmount?: number
  totalAmountPaid?: number
  isOverdue?: boolean
  isPartial?: boolean
  renegotiatedAt?: string | null
  renegotiationLinks?: RenegotiationLink[]
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  partial: 'Parcial',
  paid: 'Pago',
  overdue: 'Atrasado',
  cancelled: 'Cancelado',
  renegotiated: 'Renegociado',
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-[#FFF4EF] text-amber',
  partial: 'bg-[#FFF4EF] text-amber',
  paid: 'bg-[#F0F7F1] text-sage',
  overdue: 'bg-[#FFF4EF] text-amber-dark',
  cancelled: 'bg-white text-mid',
  renegotiated: 'bg-blue-50 text-blue-700',
}

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  partial: 'secondary',
  paid: 'default',
  overdue: 'destructive',
  cancelled: 'outline',
  renegotiated: 'secondary',
}

interface PatientFinancialTabProps {
  patientId: string
  patientName: string
}

export function PatientFinancialTab({ patientId, patientName }: PatientFinancialTabProps) {
  const { data: rawData, isLoading } = useFinancialEntries({ patientId })
  const queryClient = useQueryClient()
  const invalidateFinancial = () => queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
  const entries = (rawData?.data ?? []) as FinancialEntry[]
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showPaymentForm, setShowPaymentForm] = useState(false)

  const patients = [{ id: patientId, fullName: patientName }]

  // Compute summary totals
  const summary = useMemo(() => {
    let totalPending = 0
    let totalOverdue = 0
    let totalPaid = 0

    for (const entry of entries) {
      const amount = Number(entry.totalAmount ?? 0)
      const fineAmt = Number(entry.totalFineAmount ?? 0)
      const interestAmt = Number(entry.totalInterestAmount ?? 0)
      const amountPaid = Number(entry.totalAmountPaid ?? 0)

      if (entry.status === 'paid') {
        totalPaid += amount + fineAmt + interestAmt
      } else if (entry.status === 'overdue' || entry.isOverdue) {
        totalOverdue += amount + fineAmt + interestAmt - amountPaid
      } else if (entry.status === 'pending' || entry.status === 'partial') {
        totalPending += amount + fineAmt + interestAmt - amountPaid
      }
    }

    return { totalPending, totalOverdue, totalPaid }
  }, [entries])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-sm text-mid">Carregando financeiro...</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      {entries.length > 0 && (
        <div className="grid grid-cols-3 gap-3" data-testid="financial-summary">
          <div className="rounded-[3px] border border-sage/20 bg-white p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-medium text-mid">
              <TrendingUp className="size-3" />
              Pendente
            </div>
            <p className="text-lg font-semibold text-charcoal tabular-nums" data-testid="summary-pending">
              {formatCurrency(summary.totalPending)}
            </p>
          </div>
          <div className="rounded-[3px] border border-amber-200 bg-[#FFF4EF]/50 p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-medium text-amber-700">
              <AlertTriangle className="size-3" />
              Atrasado
            </div>
            <p className="text-lg font-semibold text-amber-700 tabular-nums" data-testid="summary-overdue">
              {formatCurrency(summary.totalOverdue)}
            </p>
          </div>
          <div className="rounded-[3px] border border-sage/20 bg-[#F0F7F1]/50 p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-medium text-sage">
              <CheckCircle className="size-3" />
              Pago
            </div>
            <p className="text-lg font-semibold text-sage tabular-nums" data-testid="summary-paid">
              {formatCurrency(summary.totalPaid)}
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-mid">
          {entries.length} {entries.length === 1 ? 'cobranca' : 'cobrancas'}
        </p>
        <Button onClick={() => setShowPaymentForm(true)}>
          <Plus className="size-4 mr-1" />
          Nova Cobranca
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-mid">
          <Wallet className="mb-2 size-8" />
          <p className="text-sm">Nenhuma cobranca registrada</p>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Descricao</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Parcelas</TableHead>
                <TableHead>Encargos</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const fineAmt = entry.totalFineAmount ?? 0
                const interestAmt = entry.totalInterestAmount ?? 0
                const renegLinks = entry.renegotiationLinks ?? []
                const wasRenegotiated = entry.status === 'renegotiated'
                const isFromRenegotiation = renegLinks.some((l) => l.newEntryId === entry.id)

                return (
                  <TableRow
                    key={entry.id}
                    className="cursor-pointer"
                    onClick={() =>
                      setExpandedId(expandedId === entry.id ? null : entry.id)
                    }
                  >
                    <TableCell>
                      {expandedId === entry.id ? (
                        <ChevronDownIcon className="size-4" />
                      ) : (
                        <ChevronRightIcon className="size-4" />
                      )}
                    </TableCell>
                    <TableCell>
                      <div>
                        {entry.description}
                        {/* Renegotiation links */}
                        {wasRenegotiated && renegLinks.length > 0 && (
                          <span className="block text-xs text-blue-600 mt-0.5" data-testid="renegotiation-to-link">
                            Renegociado → #{renegLinks.find((l) => l.originalEntryId === entry.id)?.newEntryId?.slice(0, 8) ?? '...'}
                          </span>
                        )}
                        {isFromRenegotiation && (
                          <span className="block text-xs text-blue-600 mt-0.5" data-testid="renegotiation-from-link">
                            Renegociacao de{' '}
                            {renegLinks
                              .filter((l) => l.newEntryId === entry.id)
                              .map((l) => `#${l.originalEntryId.slice(0, 8)}`)
                              .join(', ')}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{formatCurrency(Number(entry.totalAmount ?? 0))}</TableCell>
                    <TableCell>
                      {entry.paidInstallments}/{entry.installmentCount}
                    </TableCell>
                    <TableCell>
                      <PenaltyBadge
                        fineAmount={fineAmt}
                        interestAmount={interestAmt}
                        isPaid={entry.status === 'paid'}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[entry.status] ?? 'outline'}>
                        {STATUS_LABELS[entry.status] ?? entry.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(entry.createdAt)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>

          {expandedId && (
            <div className="rounded-[3px] border p-4">
              <InstallmentTable
                entryId={expandedId}
                onPaymentComplete={() => invalidateFinancial()}
              />
            </div>
          )}
        </>
      )}

      {showPaymentForm && (
        <PaymentForm
          patients={patients}
          open={showPaymentForm}
          onClose={() => setShowPaymentForm(false)}
          onSuccess={() => {
            setShowPaymentForm(false)
            invalidateFinancial()
          }}
        />
      )}
    </div>
  )
}
