'use client'

import { Fragment, useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { DateRangePicker } from '@/components/ui/date-picker'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { PAYMENT_METHOD_ITEMS } from '@/lib/financial/constants'
import { queryKeys } from '@/hooks/queries/query-keys'
import { InstallmentTable } from './installment-table'
import { PaymentForm } from './payment-form'
import { BulkActionBar } from './bulk-action-bar'
import { RenegotiationDialog } from './renegotiation-dialog'
import {
  ChevronDownIcon,
  PlusIcon,
  XIcon,
  SlidersHorizontalIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClockIcon,
  BanIcon,
  RefreshCwIcon,
  CircleDotIcon,
} from 'lucide-react'

interface Patient {
  id: string
  fullName: string
}

interface RenegotiationLink {
  originalEntryId: string
  newEntryId: string
  newEntryDescription?: string
  originalEntryDescription?: string
}

interface FinancialEntry {
  id: string
  patientId: string
  patientName: string
  description: string
  totalAmount: string
  installmentCount: number
  status: string
  notes: string | null
  createdAt: Date
  paidInstallments: number
  totalFineAmount?: number
  totalInterestAmount?: number
  totalAmountPaid?: number
  isOverdue?: boolean
  isPartial?: boolean
  renegotiatedAt?: string | null
  renegotiationLinks?: RenegotiationLink[]
  pendingInstallmentIds?: string[]
  remainingPrincipal?: number
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  partial: 'Parcial',
  paid: 'Pago',
  overdue: 'Atrasado',
  cancelled: 'Cancelado',
  renegotiated: 'Renegociado',
}

const STATUS_CONFIG: Record<string, { icon: typeof ClockIcon; bg: string; text: string; dot: string }> = {
  pending: { icon: ClockIcon, bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' },
  partial: { icon: CircleDotIcon, bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' },
  paid: { icon: CheckCircle2Icon, bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-400' },
  overdue: { icon: AlertTriangleIcon, bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-400' },
  cancelled: { icon: BanIcon, bg: 'bg-neutral-100', text: 'text-neutral-500', dot: 'bg-neutral-400' },
  renegotiated: { icon: RefreshCwIcon, bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-400' },
}

const STATUS_FILTER_ITEMS: Record<string, string> = {
  all: 'Todos',
  pending: 'Pendente',
  paid: 'Pago',
  cancelled: 'Cancelado',
  renegotiated: 'Renegociado',
}

const PAYMENT_METHOD_FILTER_ITEMS: Record<string, string> = {
  all: 'Todos métodos',
  ...PAYMENT_METHOD_ITEMS,
}

export function FinancialList({ patients, defaultPatientId, defaultPatient }: { patients: Patient[]; defaultPatientId?: string; defaultPatient?: { id: string; fullName: string } }) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const searchParams = useSearchParams()

  const statusFilter = searchParams.get('status') ?? ''
  const isOverdueFilter = searchParams.get('isOverdue') === 'true'
  const isPartialFilter = searchParams.get('isPartial') === 'true'
  const patientFilter = defaultPatientId ?? searchParams.get('patientId') ?? ''
  const dateFromFilter = searchParams.get('dateFrom') ?? ''
  const dateToFilter = searchParams.get('dateTo') ?? ''
  const paymentMethodFilter = searchParams.get('paymentMethod') ?? ''
  const page = parseInt(searchParams.get('page') ?? '1', 10)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [renegDialogOpen, setRenegDialogOpen] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (!value) {
        params.delete(key)
      } else {
        params.set(key, value)
      }
      if (key !== 'page') params.set('page', '1')
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [searchParams, router],
  )

  const clearFilters = useCallback(() => {
    router.replace('?', { scroll: false })
  }, [router])

  const hasActiveFilters = statusFilter || isOverdueFilter || isPartialFilter || patientFilter || dateFromFilter || dateToFilter || paymentMethodFilter
  const activeFilterCount = [statusFilter, isOverdueFilter, isPartialFilter, patientFilter, dateFromFilter, dateToFilter, paymentMethodFilter].filter(Boolean).length

  const filters = {
    status: statusFilter || undefined,
    isOverdue: isOverdueFilter || undefined,
    isPartial: isPartialFilter || undefined,
    patientId: patientFilter || undefined,
    dateFrom: dateFromFilter || undefined,
    dateTo: dateToFilter || undefined,
    paymentMethod: paymentMethodFilter || undefined,
    page,
    limit: 20,
  }

  const { data: result, isPending, isFetching } = useQuery({
    queryKey: queryKeys.financial.entries(filters as Record<string, unknown>),
    placeholderData: (prev) => prev, // Keep showing stale data while refetching
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters.status) params.set('status', filters.status)
      if (filters.isOverdue) params.set('isOverdue', 'true')
      if (filters.isPartial) params.set('isPartial', 'true')
      if (filters.patientId) params.set('patientId', filters.patientId)
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
      if (filters.dateTo) params.set('dateTo', filters.dateTo)
      if (filters.paymentMethod) params.set('paymentMethod', filters.paymentMethod)
      params.set('page', String(page))
      params.set('limit', '20')
      const res = await fetch(`/api/financial?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar financeiro')
      }
      return res.json()
    },
  })

  const entries: FinancialEntry[] = result?.data ?? []
  const total = result?.total ?? 0
  const totalPages = result?.totalPages ?? 1

  const fetchEntries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
  }, [queryClient])

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === entries.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(entries.map((e) => e.id)))
  }

  const selectedEntries = useMemo(
    () => entries.filter((e) => selectedIds.has(e.id)),
    [entries, selectedIds],
  )

  const selectedInstallmentIds = useMemo(
    () => selectedEntries.flatMap((e) => e.pendingInstallmentIds ?? []),
    [selectedEntries],
  )

  const selectedEntryIds = useMemo(
    () => selectedEntries.map((e) => e.id),
    [selectedEntries],
  )

  const renegotiableEntries = useMemo(
    () => selectedEntries.filter((e) => e.status === 'pending' || e.status === 'partial'),
    [selectedEntries],
  )

  const canRenegotiate = useMemo(() => {
    if (renegotiableEntries.length === 0) return false
    const patientIds = new Set(renegotiableEntries.map((e) => e.patientId))
    return patientIds.size === 1
  }, [renegotiableEntries])

  const patientFilterItems = useMemo(
    () => {
      const items: Record<string, string> = { all: 'Todos pacientes' }
      for (const p of patients) items[p.id] = p.fullName
      return items
    },
    [patients],
  )

  const renegotiationEntries = useMemo(
    // eslint-disable-next-line react-hooks/preserve-manual-memoization -- pre-existing memoization pattern; cleanup tracked separately
    () =>
      renegotiableEntries.map((e) => ({
        id: e.id,
        description: e.description,
        patientName: e.patientName,
        remainingPrincipal: Number(e.remainingPrincipal ?? 0) || (Number(e.totalAmount ?? 0) - Number(e.totalAmountPaid ?? 0)),
        fineAmount: Number(e.totalFineAmount ?? 0),
        interestAmount: Number(e.totalInterestAmount ?? 0),
      })),
    [selectedEntries],
  )

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
            data-testid="financial-filters-toggle"
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
            {total} {total === 1 ? 'registro' : 'registros'}
          </span>
        </div>

        <Button
          className="bg-forest text-cream hover:bg-sage transition-colors shadow-sm"
          onClick={() => setShowPaymentForm(true)}
          data-testid="financial-new-charge"
        >
          <PlusIcon className="h-4 w-4" />
          Nova Cobrança
        </Button>
      </div>

      {/* Collapsible filters */}
      {showFilters && (
        <div className="rounded-lg border border-sage/15 bg-white p-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-3 flex-wrap">
            <Select items={STATUS_FILTER_ITEMS} value={statusFilter || 'all'} onValueChange={(v) => updateParam('status', !v || v === 'all' ? '' : v)}>
              <SelectTrigger className="w-[140px] border-sage/20 h-8 text-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent />
            </Select>

            {!defaultPatientId && (
              <Select items={patientFilterItems} value={patientFilter || 'all'} onValueChange={(v) => updateParam('patientId', !v || v === 'all' ? '' : v)}>
                <SelectTrigger className="w-[180px] border-sage/20 h-8 text-sm">
                  <SelectValue placeholder="Paciente" />
                </SelectTrigger>
                <SelectContent />
              </Select>
            )}

            <Select items={PAYMENT_METHOD_FILTER_ITEMS} value={paymentMethodFilter || 'all'} onValueChange={(v) => updateParam('paymentMethod', !v || v === 'all' ? '' : v)}>
              <SelectTrigger className="w-[150px] border-sage/20 h-8 text-sm">
                <SelectValue placeholder="Método" />
              </SelectTrigger>
              <SelectContent />
            </Select>

            <div className="h-5 w-px bg-sage/15" />

            <DateRangePicker
              dateFrom={dateFromFilter}
              dateTo={dateToFilter}
              onDateFromChange={(v) => updateParam('dateFrom', v)}
              onDateToChange={(v) => updateParam('dateTo', v)}
            />

            <div className="h-5 w-px bg-sage/15" />

            <div className="flex items-center gap-1.5">
              <Switch
                checked={isOverdueFilter}
                onCheckedChange={(checked) => updateParam('isOverdue', checked ? 'true' : '')}
                size="sm"
              />
              <Label className="text-xs text-mid cursor-pointer select-none">Atrasados</Label>
            </div>

            <div className="flex items-center gap-1.5">
              <Switch
                checked={isPartialFilter}
                onCheckedChange={(checked) => updateParam('isPartial', checked ? 'true' : '')}
                size="sm"
              />
              <Label className="text-xs text-mid cursor-pointer select-none">Parciais</Label>
            </div>
          </div>
        </div>
      )}

      {/* Entries list */}
      <div className={cn("space-y-2 transition-opacity duration-200", isFetching && !isPending && "opacity-60")}>
        {/* Select all header */}
        {entries.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-1.5" data-testid="financial-select-all">
            <Checkbox
              checked={entries.length > 0 && selectedIds.size === entries.length}
              onCheckedChange={toggleSelectAll}
              aria-label="Selecionar todos"
            />
            <span className="text-[10px] uppercase tracking-[0.15em] text-mid font-medium select-none">
              {selectedIds.size > 0 ? `${selectedIds.size} selecionado${selectedIds.size > 1 ? 's' : ''}` : 'Selecionar todos'}
            </span>
          </div>
        )}

        {/* Loading */}
        {isPending && entries.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <span className="flex items-center gap-2 text-sm text-mid">
              <span className="size-2 animate-pulse rounded-full bg-sage" />
              Carregando cobranças...
            </span>
          </div>
        )}

        {/* Empty state */}
        {!isPending && entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-sage/10 p-4 mb-4">
              <ClockIcon className="h-6 w-6 text-sage" />
            </div>
            <p className="text-sm font-medium text-charcoal">Nenhuma cobrança registrada</p>
            <p className="text-xs text-mid mt-1">Crie sua primeira cobrança para começar</p>
          </div>
        )}

        {/* Entry cards */}
        {entries.map((entry) => {
          const fineAmt = Number(entry.totalFineAmount ?? 0)
          const interestAmt = Number(entry.totalInterestAmount ?? 0)
          const penaltyTotal = fineAmt + interestAmt
          const isSelected = selectedIds.has(entry.id)
          const isExpanded = expandedId === entry.id
          const statusConf = STATUS_CONFIG[entry.status] ?? STATUS_CONFIG.pending
          const StatusIcon = statusConf.icon
          const progressPercent = entry.installmentCount > 0
            ? Math.round((entry.paidInstallments / entry.installmentCount) * 100)
            : 0

          const renegLinks = entry.renegotiationLinks ?? []
          const wasRenegotiated = entry.status === 'renegotiated'
          const isFromRenegotiation = renegLinks.some((l) => l.newEntryId === entry.id)

          return (
            <Fragment key={entry.id}>
              <div
                data-testid={`financial-entry-${entry.id}`}
                className={cn(
                  'group rounded-lg border bg-white transition-all duration-200',
                  isSelected
                    ? 'border-sage/40 ring-1 ring-sage/20 bg-[#F8FAF8]'
                    : 'border-[#E8ECEF] hover:border-sage/25 hover:shadow-sm',
                  isExpanded && 'shadow-md border-sage/30',
                )}
              >
                {/* Main row */}
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Checkbox */}
                  <div onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleSelect(entry.id)}
                      aria-label={`Selecionar ${entry.description}`}
                    />
                  </div>

                  {/* Status indicator */}
                  <div className={cn('flex items-center justify-center w-8 h-8 rounded-full shrink-0', statusConf.bg)}>
                    <StatusIcon className={cn('h-3.5 w-3.5', statusConf.text)} />
                  </div>

                  {/* Main content */}
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-sm text-charcoal truncate">
                        {entry.patientName}
                      </span>
                      <span className="text-xs text-mid shrink-0">
                        {formatDate(entry.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-mid truncate">{entry.description}</span>
                      {wasRenegotiated && renegLinks.length > 0 && (
                        <span className="text-[10px] text-blue-600 font-medium shrink-0">
                          Renegociado
                        </span>
                      )}
                      {isFromRenegotiation && (
                        <span className="text-[10px] text-blue-600 font-medium shrink-0">
                          Renegociação
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Installment progress */}
                  <div
                    className="hidden sm:flex flex-col items-center gap-1 w-16 shrink-0 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  >
                    <div className="w-full h-1 rounded-full bg-[#E8ECEF] overflow-hidden">
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

                  {/* Penalties */}
                  {penaltyTotal > 0 && (
                    <div className="hidden md:flex flex-col items-end shrink-0">
                      {fineAmt > 0 && (
                        <span className="text-[10px] text-amber-700 tabular-nums">
                          Multa {formatCurrency(fineAmt)}
                        </span>
                      )}
                      {interestAmt > 0 && (
                        <span className="text-[10px] text-amber-700 tabular-nums">
                          Juros {formatCurrency(interestAmt)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Amount */}
                  <div
                    className="text-right shrink-0 w-28 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  >
                    <span className={cn(
                      'text-sm font-semibold tabular-nums',
                      entry.isOverdue ? 'text-red-700' : 'text-charcoal'
                    )}>
                      {formatCurrency(Number(entry.totalAmount ?? 0))}
                    </span>
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      <span className={cn(
                        'inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium',
                        statusConf.bg, statusConf.text
                      )}>
                        {STATUS_LABELS[entry.status] ?? entry.status}
                      </span>
                    </div>
                  </div>

                  {/* Expand chevron */}
                  <button
                    type="button"
                    className="p-1 text-mid hover:text-charcoal transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    aria-label={isExpanded ? 'Recolher' : 'Expandir'}
                    data-testid="financial-entry-expand"
                  >
                    <ChevronDownIcon className={cn(
                      'h-4 w-4 transition-transform duration-200',
                      isExpanded && 'rotate-180'
                    )} />
                  </button>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-sage/10 bg-[#FAFBFA] px-4 py-4 rounded-b-lg animate-in fade-in slide-in-from-top-1 duration-200">
                    <InstallmentTable entryId={entry.id} onPaymentComplete={fetchEntries} />
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
            onClick={() => updateParam('page', String(page - 1))}
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
            onClick={() => updateParam('page', String(page + 1))}
          >
            Próxima
          </Button>
        </div>
      )}

      {/* Bulk action bar */}
      <BulkActionBar
        selectedCount={selectedIds.size}
        selectedInstallmentIds={selectedInstallmentIds}
        selectedEntryIds={selectedEntryIds}
        canRenegotiate={canRenegotiate}
        onClear={() => setSelectedIds(new Set())}
        onRenegotiate={() => setRenegDialogOpen(true)}
        onSuccess={fetchEntries}
      />

      {/* Renegotiation dialog */}
      {renegDialogOpen && renegotiationEntries.length > 0 && (
        <RenegotiationDialog
          open={renegDialogOpen}
          onOpenChange={setRenegDialogOpen}
          entries={renegotiationEntries}
          onSuccess={() => {
            setSelectedIds(new Set())
            fetchEntries()
          }}
        />
      )}

      {/* New charge form */}
      {showPaymentForm && (
        <PaymentForm
          open={showPaymentForm}
          onClose={() => setShowPaymentForm(false)}
          defaultPatient={defaultPatient}
          onSuccess={() => {
            setShowPaymentForm(false)
            fetchEntries()
          }}
        />
      )}
    </div>
  )
}
