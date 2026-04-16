'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { queryKeys } from '@/hooks/queries/query-keys'
import { subMonths, format } from 'date-fns'
import { toLocalYmd } from '@/lib/dates'
import { DollarSignIcon, ClockIcon, AlertTriangleIcon, TrendingUpIcon, WalletIcon } from 'lucide-react'

const DONUT_COLORS = [
  '#1C2B1E', // Forest
  '#4A6B52', // Sage
  '#8FB49A', // Mint
  '#E8D5C8', // Blush
  '#C4A882', // Gold
  '#D4845A', // Amber
]

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'PIX',
  credit_card: 'Cartão Crédito',
  debit_card: 'Cartão Débito',
  cash: 'Dinheiro',
  transfer: 'Transferência',
}

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
    totalExpenses?: number
  }
  monthly: { month: string; total: number; expenses?: number }[]
  byProcedureType: { procedureTypeName: string; total: number }[]
  byPaymentMethod: { paymentMethod: string; total: number }[]
}

export function RevenueChart() {
  const dateRange = useMemo(() => {
    const now = new Date()
    return {
      dateFrom: toLocalYmd(subMonths(now, 6)),
      dateTo: toLocalYmd(now),
    }
  }, [])

  const { data, isPending } = useQuery({
    queryKey: queryKeys.financial.revenue(dateRange.dateFrom, dateRange.dateTo),
    queryFn: async () => {
      const params = new URLSearchParams({
        dateFrom: dateRange.dateFrom,
        dateTo: dateRange.dateTo,
      })
      const res = await fetch(`/api/financial/overview?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar receita')
      }
      return res.json() as Promise<RevenueData>
    },
  })

  if (isPending || !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-16">
        <span className="size-2 animate-pulse rounded-full bg-sage" />
        <span className="text-sm text-mid">Carregando dados financeiros...</span>
      </div>
    )
  }

  const totalExpensesPaid = Number(data.summary.totalExpenses ?? 0)
  const totalReceived = Number(data.summary.totalReceived)
  const netProfit = totalReceived - totalExpensesPaid
  const netIsPositive = netProfit >= 0

  const monthlyChartData = data.monthly.map((m) => {
    const [year, month] = (m.month ?? '').split('-')
    return {
      name: MONTH_NAMES[month] ? `${MONTH_NAMES[month]}/${year?.slice(2)}` : m.month,
      receitas: Number(m.total),
      despesas: Number(m.expenses ?? 0),
    }
  })

  const procedureChartData = data.byProcedureType
    .filter((p) => Number(p.total) > 0)
    .map((p) => ({
      name: p.procedureTypeName,
      value: Number(p.total),
    }))

  const paymentMethodData = data.byPaymentMethod
    .filter((p) => Number(p.total) > 0)
    .map((p) => ({
      name: PAYMENT_METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod,
      value: Number(p.total),
    }))

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card size="sm" className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs uppercase tracking-wider font-medium text-mid">Total Recebido</CardTitle>
            <div className="rounded-full bg-mint/20 p-2">
              <DollarSignIcon className="size-4 text-sage" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-charcoal tabular-nums tracking-tight">
              {formatCurrency(totalReceived)}
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

        <Card size="sm" className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]" data-testid="net-profit-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs uppercase tracking-wider font-medium text-mid">Lucro Líquido</CardTitle>
            <div className={`rounded-full p-2 ${netIsPositive ? 'bg-[#F0F7F1]' : 'bg-red-50'}`}>
              {netIsPositive ? (
                <TrendingUpIcon className="size-4 text-[#1C2B1E]" />
              ) : (
                <WalletIcon className="size-4 text-red-600" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold tabular-nums tracking-tight ${netIsPositive ? 'text-[#1C2B1E]' : 'text-red-600'}`}>
              {formatCurrency(netProfit)}
            </div>
            <p className="text-[10px] text-mid mt-1">Recebido - Despesas pagas</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Monthly revenue + expenses stacked bar chart */}
        <Card className="rounded-[3px] shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <CardHeader>
            <CardTitle className="text-[14px] font-medium text-[#2A2A2A]">Receitas x Despesas Mensal</CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyChartData.length === 0 ? (
              <p className="py-8 text-center text-sm text-mid">
                Sem dados no período
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
                    formatter={(value, name) => [
                      formatCurrency(Number(value)),
                      name === 'receitas' ? 'Receitas' : 'Despesas',
                    ]}
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
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    formatter={(value: string) => (
                      <span className="text-sm text-charcoal">
                        {value === 'receitas' ? 'Receitas' : 'Despesas'}
                      </span>
                    )}
                  />
                  <Bar
                    dataKey="receitas"
                    stackId="monthly"
                    fill="#4A6B52"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="despesas"
                    stackId="monthly"
                    fill="#DC2626"
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
                Sem dados de procedimentos no período
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

        {/* Payment method donut chart */}
        <Card className="rounded-[3px] shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <CardHeader>
            <CardTitle className="text-[14px] font-medium text-[#2A2A2A]">Receita por Método de Pagamento</CardTitle>
          </CardHeader>
          <CardContent>
            {paymentMethodData.length === 0 ? (
              <p className="py-8 text-center text-sm text-mid">
                Sem dados de pagamento no período
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={paymentMethodData}
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={105}
                    paddingAngle={3}
                    dataKey="value"
                    nameKey="name"
                    strokeWidth={0}
                  >
                    {paymentMethodData.map((_, index) => (
                      <Cell
                        key={`pm-cell-${index}`}
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
