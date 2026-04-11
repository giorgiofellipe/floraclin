'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'

interface ProcedureTypeBreakdown {
  name: string
  revenue: number
  count: number
}

interface PractitionerPLData {
  practitionerId: string
  practitionerName: string
  revenueGenerated: number
  revenueCollected: number
  procedureCount: number
  averageTicket: number
  byProcedureType: ProcedureTypeBreakdown[]
}

export function PractitionerCard({ data }: { data: PractitionerPLData }) {
  return (
    <Card className="rounded-[3px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] border border-[#4A6B52]/15">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-[#1C2B1E]">
          {data.practitionerName}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Metric boxes */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md bg-[#F0F7F1] p-3">
            <p className="text-[10px] uppercase tracking-wider text-[#7A7A7A] font-medium">Receita Gerada</p>
            <p className="mt-1 text-lg font-bold text-[#1C2B1E] tabular-nums" data-testid="revenue-generated">
              {formatCurrency(data.revenueGenerated)}
            </p>
            <p className="text-[10px] text-[#7A7A7A]">Competência</p>
          </div>
          <div className="rounded-md bg-[#F0F7F1] p-3">
            <p className="text-[10px] uppercase tracking-wider text-[#7A7A7A] font-medium">Receita Recebida</p>
            <p className="mt-1 text-lg font-bold text-[#1C2B1E] tabular-nums" data-testid="revenue-collected">
              {formatCurrency(data.revenueCollected)}
            </p>
            <p className="text-[10px] text-[#7A7A7A]">Caixa</p>
          </div>
          <div className="rounded-md bg-white border border-[#4A6B52]/10 p-3">
            <p className="text-[10px] uppercase tracking-wider text-[#7A7A7A] font-medium">Procedimentos</p>
            <p className="mt-1 text-lg font-bold text-charcoal tabular-nums" data-testid="procedure-count">
              {data.procedureCount}
            </p>
          </div>
          <div className="rounded-md bg-white border border-[#4A6B52]/10 p-3">
            <p className="text-[10px] uppercase tracking-wider text-[#7A7A7A] font-medium">Ticket Médio</p>
            <p className="mt-1 text-lg font-bold text-[#1C2B1E] tabular-nums" data-testid="average-ticket">
              {formatCurrency(data.averageTicket)}
            </p>
          </div>
        </div>

        {/* Procedure type breakdown */}
        {data.byProcedureType.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[#7A7A7A] font-medium mb-2">
              Por Tipo de Procedimento
            </p>
            <div className="rounded-md border border-[#4A6B52]/10 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E8ECEF] bg-[#F9FAFB]">
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-[#7A7A7A] font-medium">Tipo</th>
                    <th className="px-3 py-2 text-center text-[10px] uppercase tracking-wider text-[#7A7A7A] font-medium">Qtd</th>
                    <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-[#7A7A7A] font-medium">Receita</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byProcedureType.map((pt) => (
                    <tr key={pt.name} className="border-b border-[#E8ECEF] last:border-b-0">
                      <td className="px-3 py-2 text-charcoal">{pt.name}</td>
                      <td className="px-3 py-2 text-center text-mid tabular-nums">{pt.count}</td>
                      <td className="px-3 py-2 text-right font-medium text-[#1C2B1E] tabular-nums">
                        {formatCurrency(pt.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
