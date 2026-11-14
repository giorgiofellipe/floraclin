'use client'

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { formatCurrency } from '@/lib/utils'
import { parseLocalDate } from '@/lib/dates'

interface CashFlowMonth {
  month: string
  received: number
  expenses: number
}

const SERIES = {
  received: { label: 'Recebido', color: 'var(--color-sage)' },
  expenses: { label: 'Despesas', color: 'var(--color-amber)' },
} as const

function monthLabel(month: string) {
  const label = format(parseLocalDate(`${month}-01`), 'MMM/yy', { locale: ptBR })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function compactAmount(value: number) {
  return value >= 1000 ? `${Math.round(value / 1000)} mil` : String(Math.round(value))
}

export function CashFlowChart({ months, selected }: { months: CashFlowMonth[]; selected: string }) {
  const data = months.map((m) => ({ ...m, name: monthLabel(m.month) }))

  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} barGap={2} barCategoryGap="24%" margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--color-mid)' }} tickLine={false} axisLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--color-mid)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={compactAmount}
            width={48}
          />
          <Tooltip
            formatter={(value, key) => [formatCurrency(Number(value)), SERIES[key as keyof typeof SERIES].label]}
            cursor={{ fill: 'var(--color-petal)', opacity: 0.5 }}
            contentStyle={{
              borderRadius: 8,
              border: 'none',
              backgroundColor: 'var(--color-forest)',
              padding: '8px 12px',
              fontSize: 13,
            }}
            labelStyle={{ color: 'var(--color-mint)', marginBottom: 2 }}
            itemStyle={{ color: 'var(--color-cream)' }}
          />
          {(['received', 'expenses'] as const).map((key) => (
            <Bar key={key} dataKey={key} fill={SERIES[key].color} radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false}>
              {data.map((m) => (
                <Cell key={m.month} fillOpacity={m.month === selected ? 1 : 0.55} />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2 flex justify-center gap-4 text-xs text-mid">
        {Object.values(SERIES).map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}
