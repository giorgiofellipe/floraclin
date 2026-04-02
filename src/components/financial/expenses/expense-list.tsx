'use client'

import { Fragment, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { DateRangePicker } from '@/components/ui/date-picker'
import { Switch } from '@/components/ui/switch'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { useExpenses } from '@/hooks/queries/use-expenses'
import { useExpenseCategories } from '@/hooks/queries/use-financial-settings'
import { ExpenseForm } from './expense-form'
import { ExpenseDetail } from './expense-detail'
import { getCategoryIcon } from './category-icon'
import { PAYMENT_METHOD_ITEMS } from '@/lib/financial/constants'
import {
  PlusIcon,
  SlidersHorizontalIcon,
  ChevronDownIcon,
  CheckCircle2Icon,
  ClockIcon,
  AlertTriangleIcon,
  BanIcon,
  CalendarIcon,
  WalletIcon,
} from 'lucide-react'

interface ExpenseEntry {
  id: string
  categoryId: string
  categoryName: string
  categoryIcon: string
  description: string
  totalAmount: string
  installmentCount: number
  paidInstallments: number
  status: string
  isOverdue?: boolean
  createdAt: string
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  cancelled: 'Cancelado',
  overdue: 'Atrasado',
}

const STATUS_CONFIG: Record<string, { icon: typeof ClockIcon; bg: string; text: string }> = {
  pending: { icon: ClockIcon, bg: 'bg-amber-50', text: 'text-amber-700' },
  paid: { icon: CheckCircle2Icon, bg: 'bg-emerald-50', text: 'text-emerald-700' },
  cancelled: { icon: BanIcon, bg: 'bg-neutral-100', text: 'text-neutral-500' },
  overdue: { icon: AlertTriangleIcon, bg: 'bg-red-50', text: 'text-red-700' },
}

const STATUS_FILTER_ITEMS: Record<string, string> = {
  all: 'Todos',
  pending: 'Pendente',
  paid: 'Pago',
  cancelled: 'Cancelado',
}

const PAYMENT_METHOD_FILTER_ITEMS: Record<string, string> = {
  all: 'Todos métodos',
  ...PAYMENT_METHOD_ITEMS,
}

export function ExpenseList() {
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>('')
  const [isOverdueFilter, setIsOverdueFilter] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  const filters = {
    status: statusFilter || undefined,
    categoryId: categoryFilter || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    paymentMethod: paymentMethodFilter || undefined,
    isOverdue: isOverdueFilter || undefined,
    page,
    limit: 20,
  }

  const { data: result, isPending, isFetching } = useExpenses(filters)
  const { data: categoriesResponse } = useExpenseCategories()
  const categories = categoriesResponse?.data ?? []

  const categoryFilterItems = useMemo(() => {
    const items: Record<string, string> = { all: 'Todas categorias' }
    for (const cat of (categories as { id: string; name: string; icon: string }[])) {
      items[cat.id] = cat.name
    }
    return items
  }, [categories])

  const entries: ExpenseEntry[] = result?.data ?? []
  const total = result?.total ?? 0
  const totalPages = result?.totalPages ?? 1

  const hasActiveFilters = statusFilter || categoryFilter || dateFrom || dateTo || paymentMethodFilter || isOverdueFilter
  const activeFilterCount = [statusFilter, categoryFilter, dateFrom, dateTo, paymentMethodFilter, isOverdueFilter].filter(Boolean).length

  function getDisplayStatus(entry: ExpenseEntry): string {
    if (entry.isOverdue && entry.status === 'pending') return 'overdue'
    return entry.status
  }

  function clearFilters() {
    setStatusFilter('')
    setCategoryFilter('')
    setDateFrom('')
    setDateTo('')
    setPaymentMethodFilter('')
    setIsOverdueFilter(false)
    setPage(1)
  }

  return (
    <div className="space-y-3">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant={showFilters ? 'default' : 'outline'}
            size="sm"
            className={cn(
              'transition-all',
              showFilters
                ? 'bg-sage text-cream hover:bg-forest'
                : 'border-sage/20 text-mid hover:text-charcoal hover:bg-[#F0F7F1]'
            )}
            onClick={() => setShowFilters(!showFilters)}
            data-testid="expense-filters-toggle"
          >
            <SlidersHorizontalIcon className="h-3.5 w-3.5" />
            Filtros
            {activeFilterCount > 0 && (
              <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold">
                {activeFilterCount}
              </span>
            )}
          </Button>

          {hasActiveFilters && (
            <button
              className="text-xs text-mid hover:text-charcoal transition-colors underline underline-offset-2"
              onClick={clearFilters}
            >
              Limpar
            </button>
          )}

          <span className="text-xs text-mid tabular-nums ml-1">
            {total} {total === 1 ? 'despesa' : 'despesas'}
          </span>
        </div>

        <Button
          className="bg-forest text-cream hover:bg-sage transition-colors shadow-sm"
          onClick={() => setShowForm(true)}
          data-testid="new-expense-button"
        >
          <PlusIcon className="h-4 w-4" />
          Nova Despesa
        </Button>
      </div>

      {/* Collapsible filters */}
      {showFilters && (
        <div className="rounded-lg border border-sage/15 bg-white p-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-3 flex-wrap">
            <Select items={STATUS_FILTER_ITEMS} value={statusFilter || 'all'} onValueChange={(v) => { setStatusFilter(!v || v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-[130px] border-sage/20 h-8 text-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent />
            </Select>

            <Select items={categoryFilterItems} value={categoryFilter || 'all'} onValueChange={(v) => { setCategoryFilter(!v || v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-[170px] border-sage/20 h-8 text-sm">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent />
            </Select>

            <Select items={PAYMENT_METHOD_FILTER_ITEMS} value={paymentMethodFilter || 'all'} onValueChange={(v) => { setPaymentMethodFilter(!v || v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-[150px] border-sage/20 h-8 text-sm">
                <SelectValue placeholder="Método" />
              </SelectTrigger>
              <SelectContent />
            </Select>

            <div className="h-5 w-px bg-sage/15" />

            <DateRangePicker
              dateFrom={dateFrom}
              dateTo={dateTo}
              onDateFromChange={(v) => { setDateFrom(v); setPage(1) }}
              onDateToChange={(v) => { setDateTo(v); setPage(1) }}
            />

            <div className="h-5 w-px bg-sage/15" />

            <div className="flex items-center gap-1.5">
              <Switch
                checked={isOverdueFilter}
                onCheckedChange={(val) => { setIsOverdueFilter(val === true); setPage(1) }}
                size="sm"
              />
              <Label className="text-xs text-mid cursor-pointer select-none">Atrasadas</Label>
            </div>
          </div>
        </div>
      )}

      {/* Expense cards */}
      <div className={cn("space-y-2 transition-opacity duration-200", isFetching && !isPending && "opacity-60")}>
        {/* Loading */}
        {isPending && entries.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <span className="flex items-center gap-2 text-sm text-mid">
              <span className="size-2 animate-pulse rounded-full bg-sage" />
              Carregando despesas...
            </span>
          </div>
        )}

        {/* Empty state */}
        {!isPending && entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-sage/10 p-4 mb-4">
              <WalletIcon className="h-6 w-6 text-sage" />
            </div>
            <p className="text-sm font-medium text-charcoal">Nenhuma despesa registrada</p>
            <p className="text-xs text-mid mt-1">Registre sua primeira despesa para começar</p>
          </div>
        )}

        {/* Entry cards */}
        {entries.map((entry) => {
          const displayStatus = getDisplayStatus(entry)
          const statusConf = STATUS_CONFIG[displayStatus] ?? STATUS_CONFIG.pending
          const StatusIcon = statusConf.icon
          const CategoryIcon = getCategoryIcon(entry.categoryIcon)
          const isExpanded = expandedId === entry.id
          const progressPercent = entry.installmentCount > 0
            ? Math.round((entry.paidInstallments / entry.installmentCount) * 100)
            : 0

          return (
            <Fragment key={entry.id}>
              <div
                data-testid={`expense-entry-${entry.id}`}
                className={cn(
                  'group rounded-lg border bg-white transition-all duration-200',
                  isExpanded
                    ? 'border-sage/30 shadow-md'
                    : 'border-[#E8ECEF] hover:border-sage/25 hover:shadow-sm',
                )}
              >
                {/* Main row */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                >
                  {/* Category icon */}
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-sage/10 shrink-0">
                    <CategoryIcon className="h-4 w-4 text-sage" />
                  </div>

                  {/* Main content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-sm text-charcoal truncate">
                        {entry.description}
                      </span>
                      <span className="text-[10px] text-mid font-medium shrink-0">
                        {entry.categoryName}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="flex items-center gap-1 text-xs text-mid">
                        <CalendarIcon className="h-3 w-3" />
                        {formatDate(entry.createdAt)}
                      </span>
                      {/* Progress bar */}
                      <div className="flex items-center gap-1.5">
                        <div className="w-12 h-1 rounded-full bg-[#E8ECEF] overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full transition-all duration-500',
                              progressPercent >= 100 ? 'bg-emerald-400' : progressPercent > 0 ? 'bg-amber-400' : 'bg-transparent'
                            )}
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-mid tabular-nums">
                          {entry.paidInstallments}/{entry.installmentCount}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Amount */}
                  <div className="text-right shrink-0">
                    <span className={cn(
                      'text-sm font-semibold tabular-nums',
                      displayStatus === 'overdue' ? 'text-red-700' : 'text-charcoal'
                    )}>
                      {formatCurrency(Number(entry.totalAmount))}
                    </span>
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      <span className={cn(
                        'inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium',
                        statusConf.bg, statusConf.text
                      )}>
                        <StatusIcon className="h-3 w-3" />
                        {STATUS_LABELS[displayStatus] ?? displayStatus}
                      </span>
                    </div>
                  </div>

                  {/* Expand chevron */}
                  <ChevronDownIcon className={cn(
                    'h-4 w-4 text-mid transition-transform duration-200 shrink-0',
                    isExpanded && 'rotate-180'
                  )} />
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-sage/10 bg-[#FAFBFA] px-4 py-4 rounded-b-lg animate-in fade-in slide-in-from-top-1 duration-200">
                    <ExpenseDetail expenseId={entry.id} />
                  </div>
                )}
              </div>
            </Fragment>
          )
        })}
      </div>

      {/* Pagination */}
      {entries.length > 0 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="border-sage/20 text-charcoal hover:bg-[#F0F7F1] transition-colors"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </Button>
          <span className="text-xs text-mid tabular-nums">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="border-sage/20 text-charcoal hover:bg-[#F0F7F1] transition-colors"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      )}

      {/* Form dialog */}
      {showForm && (
        <ExpenseForm
          open={showForm}
          onClose={() => setShowForm(false)}
          onSuccess={() => setShowForm(false)}
        />
      )}
    </div>
  )
}
