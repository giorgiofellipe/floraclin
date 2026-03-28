'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
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
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        Carregando dados financeiros...
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
        <Card size="sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Recebido</CardTitle>
            <DollarSignIcon className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(Number(data.summary.totalReceived))}
            </div>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Pendente</CardTitle>
            <ClockIcon className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(Number(data.summary.totalPending))}
            </div>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Atrasado</CardTitle>
            <AlertTriangleIcon className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber">
              {formatCurrency(Number(data.summary.totalOverdue))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Monthly revenue bar chart */}
        <Card>
          <CardHeader>
            <CardTitle>Receita Mensal</CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyChartData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Sem dados de receita no período
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyChartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="name"
                    className="text-xs fill-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    className="text-xs fill-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(value) => [formatCurrency(Number(value)), 'Receita']}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid hsl(var(--border))',
                      backgroundColor: 'hsl(var(--popover))',
                      color: 'hsl(var(--popover-foreground))',
                    }}
                  />
                  <Bar
                    dataKey="total"
                    fill="#4A6B52"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Revenue by procedure type donut chart */}
        <Card>
          <CardHeader>
            <CardTitle>Receita por Tipo de Procedimento</CardTitle>
          </CardHeader>
          <CardContent>
            {procedureChartData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Sem dados de procedimentos no período
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={procedureChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
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
                      borderRadius: '8px',
                      border: '1px solid hsl(var(--border))',
                      backgroundColor: 'hsl(var(--popover))',
                      color: 'hsl(var(--popover-foreground))',
                    }}
                  />
                  <Legend
                    formatter={(value: string) => (
                      <span className="text-sm text-foreground">{value}</span>
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
