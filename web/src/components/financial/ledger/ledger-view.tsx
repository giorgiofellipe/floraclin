'use client'

import { useState, useMemo } from 'react'
import { useLedger } from '@/hooks/queries/use-ledger'
import { useFinancialPatients } from '@/hooks/queries/use-financial'
import { useExpenseCategories } from '@/hooks/queries/use-financial-settings'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { DateRangePicker } from '@/components/ui/date-picker'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LedgerSummaryCards } from './ledger-summary-cards'
import { LedgerExport } from './ledger-export'
import {
  ArrowUpRightIcon,
  ArrowDownRightIcon,
  FilterXIcon,
} from 'lucide-react'
import { startOfMonth, format } from 'date-fns'
import { PAYMENT_METHOD_ITEMS } from '@/lib/financial/constants'

const PAYMENT_METHOD_FILTER_ITEMS: Record<string, string> = {
  all: 'Todos',
  ...PAYMENT_METHOD_ITEMS,
}

const TYPE_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'inflow', label: 'Entradas' },
  { value: 'outflow', label: 'Saídas' },
]

export function LedgerView() {
  const now = useMemo(() => new Date(), [])
  const [movementType, setMovementType] = useState('all')
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(now), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(now, 'yyyy-MM-dd'))
  const [paymentMethod, setPaymentMethod] = useState('')
  const [patientId, setPatientId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [page, setPage] = useState(1)

  const filters = {
    type: movementType !== 'all' ? movementType : undefined,
    dateFrom,
    dateTo,
    paymentMethod: paymentMethod || undefined,
    patientId: patientId || undefined,
    categoryId: categoryId || undefined,
    page,
    limit: 30,
  }

  const { data, isPending, isFetching } = useLedger(filters)
  const { data: patients } = useFinancialPatients()
  const { data: categoriesResponse } = useExpenseCategories()
  const categories = categoriesResponse?.data ?? []

  const patientFilterItems = useMemo(() => {
    const items: Record<string, string> = { all: 'Todos' }
    if (patients) {
      for (const p of patients as { id: string; fullName: string }[]) {
        items[p.id] = p.fullName
      }
    }
    return items
  }, [patients])

  const categoryFilterItems = useMemo(() => {
    const items: Record<string, string> = { all: 'Todas' }
    for (const c of categories as { id: string; name: string }[]) {
      items[c.id] = c.name
    }
    return items
  }, [categories])

  const hasActiveFilters = movementType !== 'all' || paymentMethod || patientId || categoryId

  const clearFilters = () => {
    setMovementType('all')
    setPaymentMethod('')
    setPatientId('')
    setCategoryId('')
    setPage(1)
  }

  const movements = data?.movements ?? []
  const summary = data?.summary ?? { totalInflows: 0, totalOutflows: 0, netResult: 0, overdueReceivables: 0 }
  const pagination = data?.pagination ?? { total: 0, page: 1, limit: 30, totalPages: 1 }

  return (
    <div className="space-y-6">
      <LedgerSummaryCards summary={summary} />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Movement type toggle */}
        <div className="flex rounded-lg border border-sage/20 overflow-hidden">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                movementType === opt.value
                  ? 'bg-[#1C2B1E] text-cream'
                  : 'bg-white text-charcoal hover:bg-[#F0F7F1]'
              }`}
              onClick={() => { setMovementType(opt.value); setPage(1) }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Date range */}
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={(v) => { setDateFrom(v); setPage(1) }}
          onDateToChange={(v) => { setDateTo(v); setPage(1) }}
        />

        {/* Payment method */}
        <Select items={PAYMENT_METHOD_FILTER_ITEMS} value={paymentMethod || 'all'} onValueChange={(v) => { setPaymentMethod(!v || v === 'all' ? '' : v); setPage(1) }}>
          <SelectTrigger className="w-[170px] border-sage/20">
            <SelectValue placeholder="Método" />
          </SelectTrigger>
          <SelectContent />
        </Select>

        {/* Patient filter */}
        <Select items={patientFilterItems} value={patientId || 'all'} onValueChange={(v) => { setPatientId(!v || v === 'all' ? '' : v); setPage(1) }}>
          <SelectTrigger className="w-[180px] border-sage/20">
            <SelectValue placeholder="Paciente" />
          </SelectTrigger>
          <SelectContent />
        </Select>

        {/* Category filter */}
        <Select items={categoryFilterItems} value={categoryId || 'all'} onValueChange={(v) => { setCategoryId(!v || v === 'all' ? '' : v); setPage(1) }}>
          <SelectTrigger className="w-[170px] border-sage/20">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent />
        </Select>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="text-mid hover:text-charcoal"
            onClick={clearFilters}
          >
            <FilterXIcon data-icon="inline-start" />
            Limpar filtros
          </Button>
        )}

        <div className="ml-auto">
          <LedgerExport filters={{ type: filters.type, dateFrom, dateTo, paymentMethod: filters.paymentMethod, patientId: filters.patientId, categoryId: filters.categoryId }} />
        </div>
      </div>

      {/* Movements table */}
      <div className={cn("rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden transition-opacity duration-200", isFetching && !isPending && "opacity-60")}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E8ECEF]">
                <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] font-medium">Data</th>
                <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] font-medium">Tipo</th>
                <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] font-medium">Descrição</th>
                <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] font-medium">Referência</th>
                <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] font-medium">Método</th>
                <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] font-medium">Valor</th>
                <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] font-medium">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {isPending && (
                <tr>
                  <td colSpan={7} className="text-center text-mid py-12">
                    <span className="flex items-center justify-center gap-2">
                      <span className="size-2 animate-pulse rounded-full bg-sage" />
                      Carregando extrato...
                    </span>
                  </td>
                </tr>
              )}
              {!isPending && movements.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-mid py-12">
                    Nenhuma movimentação encontrada no período.
                  </td>
                </tr>
              )}
              {movements.map((m) => {
                const isInflow = m.type === 'inflow'
                return (
                  <tr
                    key={m.id}
                    className="border-b border-[#E8ECEF] last:border-b-0 hover:bg-[#F4F6F8] transition-colors"
                  >
                    <td className="px-4 py-3 text-charcoal whitespace-nowrap">
                      {formatDate(m.movementDate)}
                    </td>
                    <td className="px-4 py-3">
                      {isInflow ? (
                        <span className="inline-flex items-center gap-1 text-[#4A6B52]" data-testid="inflow-icon">
                          <ArrowUpRightIcon className="size-4" />
                          <span className="text-xs font-medium">Entrada</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-600" data-testid="outflow-icon">
                          <ArrowDownRightIcon className="size-4" />
                          <span className="text-xs font-medium">Saída</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-charcoal">{m.description}</td>
                    <td className="px-4 py-3 text-mid">
                      {m.patientName ?? m.categoryName ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      {m.paymentMethod ? (
                        <span className="inline-flex items-center rounded-full bg-[#F0F7F1] px-2 py-0.5 text-[11px] font-medium text-[#4A6B52]">
                          {PAYMENT_METHOD_ITEMS[m.paymentMethod] ?? m.paymentMethod}
                        </span>
                      ) : (
                        <span className="text-mid">—</span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium tabular-nums ${isInflow ? 'text-[#4A6B52]' : 'text-red-600'}`}>
                      {isInflow ? '+' : '-'}{formatCurrency(Number(m.amount))}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-charcoal">
                      {formatCurrency(m.runningBalance)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </Button>
          <span className="text-sm text-mid tabular-nums">
            Página {pagination.page} de {pagination.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      )}
    </div>
  )
}
