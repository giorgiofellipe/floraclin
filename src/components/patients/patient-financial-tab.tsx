'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/hooks/queries/query-keys'
import { FinancialList } from '@/components/financial/financial-list'
import { formatCurrency } from '@/lib/utils'
import { ClockIcon, AlertTriangleIcon, CheckCircle2Icon } from 'lucide-react'

interface PatientFinancialTabProps {
  patientId: string
  patientName: string
}

export function PatientFinancialTab({ patientId, patientName }: PatientFinancialTabProps) {
  const patients = [{ id: patientId, fullName: patientName }]

  const { data } = useQuery({
    queryKey: queryKeys.financial.entries({ patientId, page: 1, limit: 100 }),
    queryFn: async () => {
      const res = await fetch(`/api/financial?patientId=${patientId}&page=1&limit=100`)
      if (!res.ok) return { data: [] }
      return res.json()
    },
  })

  const summary = useMemo(() => {
    const entries = data?.data ?? []
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
      } else if (entry.isOverdue) {
        totalOverdue += amount + fineAmt + interestAmt - amountPaid
      } else if (entry.status === 'pending' || entry.status === 'partial') {
        totalPending += amount + fineAmt + interestAmt - amountPaid
      }
    }

    return { totalPending, totalOverdue, totalPaid }
  }, [data])

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-[#E8ECEF] bg-white px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <ClockIcon className="h-3.5 w-3.5 text-amber-600" />
            <span className="text-[10px] uppercase tracking-[0.15em] text-mid font-medium">Pendente</span>
          </div>
          <span className="text-lg font-semibold text-charcoal tabular-nums">
            {formatCurrency(summary.totalPending)}
          </span>
        </div>
        <div className="rounded-lg border border-[#E8ECEF] bg-white px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangleIcon className="h-3.5 w-3.5 text-red-600" />
            <span className="text-[10px] uppercase tracking-[0.15em] text-mid font-medium">Atrasado</span>
          </div>
          <span className="text-lg font-semibold text-red-700 tabular-nums">
            {formatCurrency(summary.totalOverdue)}
          </span>
        </div>
        <div className="rounded-lg border border-[#E8ECEF] bg-white px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-600" />
            <span className="text-[10px] uppercase tracking-[0.15em] text-mid font-medium">Pago</span>
          </div>
          <span className="text-lg font-semibold text-emerald-700 tabular-nums">
            {formatCurrency(summary.totalPaid)}
          </span>
        </div>
      </div>

      <FinancialList patients={patients} defaultPatientId={patientId} />
    </div>
  )
}
