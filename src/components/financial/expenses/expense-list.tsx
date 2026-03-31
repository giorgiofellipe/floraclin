'use client'

import { useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useExpenses } from '@/hooks/queries/use-expenses'
import { useExpenseCategories } from '@/hooks/queries/use-financial-settings'
import { ExpenseForm } from './expense-form'
import { ExpenseDetail } from './expense-detail'
import { ChevronRightIcon, PlusIcon } from 'lucide-react'
import { getCategoryIcon } from './category-icon'

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

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-[#FFF4EF] text-amber',
  paid: 'bg-[#F0F7F1] text-sage',
  cancelled: 'bg-white text-mid',
  overdue: 'bg-red-50 text-red-600',
}

const PAYMENT_METHOD_OPTIONS = [
  { value: 'pix', label: 'PIX' },
  { value: 'credit_card', label: 'Cartao de Credito' },
  { value: 'debit_card', label: 'Cartao de Debito' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'transfer', label: 'Transferencia' },
]

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

  const { data: result, isPending } = useExpenses(filters)
  const { data: categories } = useExpenseCategories()

  const entries: ExpenseEntry[] = result?.data ?? []
  const total = result?.total ?? 0
  const totalPages = result?.totalPages ?? 1

  const handleStatusChange = (value: string | null) => {
    setStatusFilter(!value || value === 'all' ? '' : value)
    setPage(1)
  }

  const handleCategoryChange = (value: string | null) => {
    setCategoryFilter(!value || value === 'all' ? '' : value)
    setPage(1)
  }

  const handlePaymentMethodChange = (value: string | null) => {
    setPaymentMethodFilter(!value || value === 'all' ? '' : value)
    setPage(1)
  }

  function getDisplayStatus(entry: ExpenseEntry): string {
    if (entry.isOverdue && entry.status === 'pending') return 'overdue'
    return entry.status
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="uppercase tracking-wider text-[10px] font-medium text-[#7A7A7A]">Status</Label>
          <Select value={statusFilter || 'all'} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-[140px] border-sage/20" data-testid="expense-status-filter">
              <SelectValue placeholder="Status">
                {(value: string) => {
                  if (value === 'all') return 'Todos'
                  return STATUS_LABELS[value] ?? value
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="paid">Pago</SelectItem>
              <SelectItem value="cancelled">Cancelado</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="uppercase tracking-wider text-[10px] font-medium text-[#7A7A7A]">Categoria</Label>
          <Select value={categoryFilter || 'all'} onValueChange={handleCategoryChange}>
            <SelectTrigger className="w-[160px] border-sage/20" data-testid="expense-category-filter">
              <SelectValue placeholder="Categoria">
                {(value: string) => {
                  if (value === 'all') return 'Todas'
                  const cat = (categories as { id: string; name: string }[])?.find((c) => c.id === value)
                  return cat?.name ?? value
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {(categories as { id: string; name: string; icon: string }[])?.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="uppercase tracking-wider text-[10px] font-medium text-[#7A7A7A]">Metodo Pgto.</Label>
          <Select value={paymentMethodFilter || 'all'} onValueChange={handlePaymentMethodChange}>
            <SelectTrigger className="w-[160px] border-sage/20" data-testid="expense-payment-method-filter">
              <SelectValue placeholder="Metodo">
                {(value: string) => {
                  if (value === 'all') return 'Todos'
                  return PAYMENT_METHOD_OPTIONS.find((o) => o.value === value)?.label ?? value
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {PAYMENT_METHOD_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="uppercase tracking-wider text-[10px] font-medium text-[#7A7A7A]">De</Label>
          <Input
            type="date"
            className="w-[140px] border-sage/20"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
            data-testid="expense-date-from"
          />
        </div>

        <div className="space-y-1">
          <Label className="uppercase tracking-wider text-[10px] font-medium text-[#7A7A7A]">Ate</Label>
          <Input
            type="date"
            className="w-[140px] border-sage/20"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
            data-testid="expense-date-to"
          />
        </div>

        <div className="flex items-center gap-2 pb-0.5">
          <Switch
            checked={isOverdueFilter}
            onCheckedChange={(val) => { setIsOverdueFilter(val === true); setPage(1) }}
          />
          <Label className="text-sm text-mid cursor-pointer">Atrasadas</Label>
        </div>

        <div className="ml-auto">
          <Button
            className="bg-forest text-cream hover:bg-sage transition-colors"
            onClick={() => setShowForm(true)}
            data-testid="new-expense-button"
          >
            <PlusIcon data-icon="inline-start" />
            Nova Despesa
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-mid">
          {total} {total === 1 ? 'despesa' : 'despesas'}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-white border-b border-[#E8ECEF] hover:bg-white">
              <TableHead className="w-8" />
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Categoria</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Descricao</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] text-right">Valor</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] text-center">Parcelas</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Status</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Data</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-mid py-12">
                  {isPending ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="size-2 animate-pulse rounded-full bg-sage" />
                      Carregando...
                    </span>
                  ) : 'Nenhuma despesa registrada.'}
                </TableCell>
              </TableRow>
            )}
            {entries.map((entry) => {
              const displayStatus = getDisplayStatus(entry)
              const CategoryIcon = getCategoryIcon(entry.categoryIcon)
              return (
                <TableRow
                  key={entry.id}
                  className="cursor-pointer transition-colors hover:bg-[#F4F6F8] border-b border-[#E8ECEF]"
                  onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  data-testid={`expense-row-${entry.id}`}
                >
                  <TableCell className="text-mid">
                    <div className={`transition-transform duration-200 ${expandedId === entry.id ? 'rotate-90' : ''}`}>
                      <ChevronRightIcon className="size-4" />
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <CategoryIcon className="size-4 text-sage" />
                      <span className="font-medium text-charcoal">{entry.categoryName}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-charcoal">{entry.description}</TableCell>
                  <TableCell className={`text-right font-medium tabular-nums ${displayStatus === 'overdue' ? 'text-red-600' : 'text-charcoal'}`}>
                    {formatCurrency(Number(entry.totalAmount))}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="text-sm tabular-nums text-mid">
                      {entry.paidInstallments}/{entry.installmentCount}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${STATUS_COLORS[displayStatus] ?? 'bg-white text-mid'}`}>
                      {STATUS_LABELS[displayStatus] ?? displayStatus}
                    </span>
                  </TableCell>
                  <TableCell className="text-mid text-sm">{formatDate(entry.createdAt)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Expanded detail */}
      {expandedId && (
        <div className="rounded-[3px] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-top-2 duration-200">
          <ExpenseDetail expenseId={expandedId} />
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
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
            Pagina {page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Proxima
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
