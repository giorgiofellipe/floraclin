'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { ArrowUpRightIcon, ArrowDownRightIcon, ScaleIcon, AlertTriangleIcon } from 'lucide-react'

interface LedgerSummary {
  totalInflows: number
  totalOutflows: number
  netResult: number
  overdueReceivables: number
}

export function LedgerSummaryCards({ summary }: { summary: LedgerSummary }) {
  const netIsPositive = summary.netResult >= 0

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card size="sm" className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs uppercase tracking-wider font-medium text-mid">Total Entradas</CardTitle>
          <div className="rounded-full bg-[#F0F7F1] p-2">
            <ArrowUpRightIcon className="size-4 text-[#4A6B52]" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-[#4A6B52] tabular-nums tracking-tight">
            {formatCurrency(summary.totalInflows)}
          </div>
        </CardContent>
      </Card>

      <Card size="sm" className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs uppercase tracking-wider font-medium text-mid">Total Saidas</CardTitle>
          <div className="rounded-full bg-red-50 p-2">
            <ArrowDownRightIcon className="size-4 text-red-600" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-600 tabular-nums tracking-tight">
            {formatCurrency(summary.totalOutflows)}
          </div>
        </CardContent>
      </Card>

      <Card size="sm" className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs uppercase tracking-wider font-medium text-mid">Resultado Liquido</CardTitle>
          <div className={`rounded-full p-2 ${netIsPositive ? 'bg-[#F0F7F1]' : 'bg-red-50'}`}>
            <ScaleIcon className={`size-4 ${netIsPositive ? 'text-[#1C2B1E]' : 'text-red-600'}`} />
          </div>
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold tabular-nums tracking-tight ${netIsPositive ? 'text-[#1C2B1E]' : 'text-red-600'}`}>
            {formatCurrency(summary.netResult)}
          </div>
        </CardContent>
      </Card>

      <Card size="sm" className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs uppercase tracking-wider font-medium text-mid">A Receber Vencido</CardTitle>
          <div className="rounded-full bg-amber-50 p-2">
            <AlertTriangleIcon className="size-4 text-amber-600" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-amber-600 tabular-nums tracking-tight">
            {formatCurrency(summary.overdueReceivables)}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
