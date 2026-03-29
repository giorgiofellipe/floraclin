'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { getRevenueOverviewAction } from '@/actions/financial'
import { subMonths, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { DollarSignIcon, ClockIcon, AlertTriangleIcon } from 'lucide-react'

const DONUT_COLORS = [
  '#1C2B1E', // Forest
  '#4A6B52', // Sage
  '#8FB49A', // Mint
  '#E8D5C8', // Blush
  '#C4A882', // Gold
  '#D4845A', // Amber
]

const MONTH_NAMES: Record<string, string> = {
  '01': 'Jan', '02': 'Fev', '03': 'Mar', '04': 'Abr',
  '05': 'Mai', '06': 'Jun', '07': 'Jul', '08': 'Ago',
  '09': 'Set', '10': 'Out', '11': 'Nov', '12': 'Dez',
}

interface RevenueData {
  summary: {
    totalReceived: number
    totalPending: number
    totalOverdue: number
  }
  monthly: { month: string; total: number }[]
  byProcedureType: { procedureTypeName: string; total: number }[]
  byPaymentMethod: { paymentMethod: string; total: number }[]
}

export function RevenueChart() {
  const [data, setData] = useState<RevenueData | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const now = new Date()
    const dateFrom = subMonths(now, 6).toISOString().split('T')[0]
    const dateTo = now.toISOString().split('T')[0]

    startTransition(async () => {
      const result = await getRevenueOverviewAction(dateFrom, dateTo)
      if (result.data) {
        setData(result.data as RevenueData)
      }
    })
  }, [])

  if (isPending || !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-16">
        <span className="size-2 animate-pulse rounded-full bg-sage" />
        <span className="text-sm text-mid">Carregando dados financeiros...</span>
      </div>
    )
  }

  const monthlyChartData = data.monthly.map((m) => {
    const [year, month] = (m.month ?? '').split('-')
    return {
      name: MONTH_NAMES[month] ? `${MONTH_NAMES[month]}/${year?.slice(2)}` : m.month,
      total: Number(m.total),
    }
  })

  const procedureChartData = data.byProcedureType
    .filter((p) => Number(p.total) > 0)
    .map((p) => ({
      name: p.procedureTypeName,
      value: Number(p.total),
    }))

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card size="sm" className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs uppercase tracking-wider font-medium text-mid">Total Recebido</CardTitle>
            <div className="rounded-full bg-mint/20 p-2">
              <DollarSignIcon className="size-4 text-sage" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-charcoal tabular-nums tracking-tight">
              {formatCurrency(Number(data.summary.totalReceived))}
            </div>
          </CardContent>
        </Card>

        <Card size="sm" className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs uppercase tracking-wider font-medium text-mid">Total Pendente</CardTitle>
            <div className="rounded-full bg-blush p-2">
              <ClockIcon className="size-4 text-gold" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-charcoal tabular-nums tracking-tight">
              {formatCurrency(Number(data.summary.totalPending))}
            </div>
          </CardContent>
        </Card>

        <Card size="sm" className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs uppercase tracking-wider font-medium text-mid">Total Atrasado</CardTitle>
            <div className="rounded-full bg-amber-light p-2">
              <AlertTriangleIcon className="size-4 text-amber" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber tabular-nums tracking-tight">
              {formatCurrency(Number(data.summary.totalOverdue))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Monthly revenue bar chart */}
        <Card className="rounded-[3px] shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <CardHeader>
            <CardTitle className="text-[14px] font-medium text-[#2A2A2A]">Receita Mensal</CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyChartData.length === 0 ? (
              <p className="py-8 text-center text-sm text-mid">
                Sem dados de receita no periodo
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyChartData} barCategoryGap="20%">
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12, fill: '#7A7A7A' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#7A7A7A' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`}
                    width={65}
                  />
                  <Tooltip
                    formatter={(value) => [formatCurrency(Number(value)), 'Receita']}
                    cursor={{ fill: 'rgba(74, 107, 82, 0.05)' }}
                    contentStyle={{
                      borderRadius: '12px',
                      border: 'none',
                      backgroundColor: '#1C2B1E',
                      color: '#FAF7F3',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      padding: '8px 14px',
                      fontSize: '13px',
                    }}
                    labelStyle={{ color: '#8FB49A', fontWeight: 500, marginBottom: '2px' }}
                    itemStyle={{ color: '#FAF7F3' }}
                  />
                  <Bar
                    dataKey="total"
                    fill="#4A6B52"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Revenue by procedure type donut chart */}
        <Card className="rounded-[3px] shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <CardHeader>
            <CardTitle className="text-[14px] font-medium text-[#2A2A2A]">Receita por Tipo de Procedimento</CardTitle>
          </CardHeader>
          <CardContent>
            {procedureChartData.length === 0 ? (
              <p className="py-8 text-center text-sm text-mid">
                Sem dados de procedimentos no periodo
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={procedureChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={105}
                    paddingAngle={3}
                    dataKey="value"
                    nameKey="name"
                    strokeWidth={0}
                  >
                    {procedureChartData.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={DONUT_COLORS[index % DONUT_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => [formatCurrency(Number(value)), 'Receita']}
                    contentStyle={{
                      borderRadius: '12px',
                      border: 'none',
                      backgroundColor: '#1C2B1E',
                      color: '#FAF7F3',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      padding: '8px 14px',
                      fontSize: '13px',
                    }}
                    itemStyle={{ color: '#FAF7F3' }}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    formatter={(value: string) => (
                      <span className="text-sm text-charcoal">{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
