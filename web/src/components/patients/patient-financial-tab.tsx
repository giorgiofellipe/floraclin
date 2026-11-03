'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/hooks/queries/query-keys'
import { FinancialList } from '@/components/financial/financial-list'
import { formatCurrency } from '@/lib/utils'
import { PATIENT_FINANCIAL_ENTRIES_LIMIT, summarizePatientEntries } from '@/lib/financial/patient-summary'
import { ClockIcon, AlertTriangleIcon, CheckCircle2Icon } from 'lucide-react'

interface PatientFinancialTabProps {
  patientId: string
  patientName: string
}

export function PatientFinancialTab({ patientId, patientName }: PatientFinancialTabProps) {
  const patients = [{ id: patientId, fullName: patientName }]

  const { data } = useQuery({
    queryKey: queryKeys.financial.entries({ patientId, page: 1, limit: PATIENT_FINANCIAL_ENTRIES_LIMIT }),
    queryFn: async () => {
      const res = await fetch(`/api/financial?patientId=${patientId}&page=1&limit=${PATIENT_FINANCIAL_ENTRIES_LIMIT}`)
      if (!res.ok) return { data: [] }
      return res.json()
    },
  })

  const summary = useMemo(() => {
    const { pending, overdue, paid } = summarizePatientEntries(data?.data ?? [])
    return { totalPending: pending, totalOverdue: overdue, totalPaid: paid }
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

      <FinancialList patients={patients} defaultPatientId={patientId} defaultPatient={{ id: patientId, fullName: patientName }} />
    </div>
  )
}
