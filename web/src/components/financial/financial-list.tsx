'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, useRouter } from 'next/navigation'
import { Button, buttonVariants } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { DateRangePicker } from '@/components/ui/date-picker'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { brToday } from '@/lib/dates'
import { PAYMENT_METHOD_ITEMS } from '@/lib/financial/constants'
import { CHARGE_PAYER_ROLES, hasRole } from '@/lib/financial/charge-roles'
import { DUE_BUCKET_LABELS, DUE_BUCKET_TEXT, dueBucket, dueLabel, receivedLabel, type DueBucket } from '@/lib/financial/receivables'
import { queryKeys } from '@/hooks/queries/query-keys'
import { InstallmentTable } from './installment-table'
import { PaymentForm } from './payment-form'
import { BulkActionBar } from './bulk-action-bar'
import { RenegotiationDialog } from './renegotiation-dialog'
import { ChargeActionDialogs, type ChargeDialog } from './charge-action-dialogs'
import { ChargeRowMenu } from './charge-row-menu'
import { ReceivablesTotals, type ReceivablesTotalKey } from './receivables-totals'
import {
  PlusIcon,
  SlidersHorizontalIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClockIcon,
  BanIcon,
  RefreshCwIcon,
  CircleDotIcon,
  ReceiptIcon,
  CalendarIcon,
} from 'lucide-react'
import { ReadOnlyGuard, useSubscriptionAccess, useWriteGuard } from '@/components/layout/subscription-access'

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
  paymentMethod: string | null
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
  nextInstallmentId: string | null
  nextInstallmentNumber: number | null
  nextDueDate: string | null
  lastPaidAt: string | null
  nextAmountDue: number | null
  openBalance: number
}

const OPEN_STATUSES = ['pending', 'partial', 'overdue']

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  partial: 'Parcial',
  paid: 'Recebida',
  overdue: 'Vencida',
  cancelled: 'Cancelada',
  renegotiated: 'Renegociada',
}

const STATUS_CONFIG: Record<string, { icon: typeof ClockIcon; bg: string; text: string }> = {
  pending: { icon: ClockIcon, bg: 'bg-amber-50', text: 'text-amber-700' },
  partial: { icon: CircleDotIcon, bg: 'bg-amber-50', text: 'text-amber-700' },
  paid: { icon: CheckCircle2Icon, bg: 'bg-emerald-50', text: 'text-emerald-700' },
  overdue: { icon: AlertTriangleIcon, bg: 'bg-red-50', text: 'text-red-700' },
  cancelled: { icon: BanIcon, bg: 'bg-neutral-100', text: 'text-neutral-500' },
  renegotiated: { icon: RefreshCwIcon, bg: 'bg-blue-50', text: 'text-blue-700' },
}

const VIEW_TABS = [
  { value: 'open', label: 'A receber' },
  { value: 'paid', label: 'Recebidas' },
  { value: 'all', label: 'Todas' },
]

const STATUS_FILTER_ITEMS: Record<string, string> = {
  open: 'A receber',
  pending: 'Pendentes',
  paid: 'Recebidas',
  cancelled: 'Canceladas',
  renegotiated: 'Renegociadas',
  all: 'Todas',
}

const PAYMENT_METHOD_FILTER_ITEMS: Record<string, string> = {
  all: 'Todos métodos',
  ...PAYMENT_METHOD_ITEMS,
}

const BUCKET_ORDER: DueBucket[] = ['overdue', 'today', 'upcoming']


/** "Vence 15/11 · Pendente": the row's second line, and its colour. */
function dueLine(entry: FinancialEntry, todayYmd: string): { text: string; className: string } {
  if (entry.status === 'paid') {
    return { text: entry.lastPaidAt ? receivedLabel(entry.lastPaidAt) : 'Recebida', className: 'text-emerald-700' }
  }
  if (!OPEN_STATUSES.includes(entry.status) || !entry.nextDueDate) {
    return { text: STATUS_LABELS[entry.status] ?? entry.status, className: STATUS_CONFIG[entry.status]?.text ?? 'text-mid' }
  }
  const due = dueLabel(entry.nextDueDate, todayYmd)
  const parts =
    entry.installmentCount > 1 && entry.nextInstallmentNumber
      ? [
          `Parcela ${entry.nextInstallmentNumber}/${entry.installmentCount}`,
          ...(entry.nextAmountDue !== null ? [formatCurrency(entry.nextAmountDue)] : []),
          due.charAt(0).toLowerCase() + due.slice(1),
        ]
      : [due, ...(entry.isOverdue ? [] : [entry.isPartial ? 'Parcial' : 'Pendente'])]
  return { text: parts.join(' · '), className: DUE_BUCKET_TEXT[dueBucket(entry, todayYmd)] }
}

export function FinancialList({ patients, defaultPatientId, defaultPatient }: { patients: Patient[]; defaultPatientId?: string; defaultPatient?: { id: string; fullName: string } }) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { role } = useSubscriptionAccess()
  const guard = useWriteGuard()
  const canReceive = hasRole(CHARGE_PAYER_ROLES, role)

  // Financeiro opens on what is still to receive; a patient's tab on their whole history.
  const defaultView = defaultPatientId ? 'all' : 'open'
  const viewFilter = searchParams.get('status') || defaultView
  const isOverdueFilter = searchParams.get('isOverdue') === 'true'
  const dueSoonFilter = searchParams.get('dueSoon') === 'true'
  const receivedThisMonthFilter = searchParams.get('receivedThisMonth') === 'true'
  const isPartialFilter = searchParams.get('isPartial') === 'true'
  const patientFilter = defaultPatientId ?? searchParams.get('patientId') ?? ''
  const dateFromFilter = searchParams.get('dateFrom') ?? ''
  const dateToFilter = searchParams.get('dateTo') ?? ''
  const paymentMethodFilter = searchParams.get('paymentMethod') ?? ''
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const apiStatus = viewFilter === 'all' ? undefined : viewFilter
  const setView = (view: string) => (view === defaultView ? '' : view)
  const todayYmd = brToday()

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [renegDialogOpen, setRenegDialogOpen] = useState(false)
  // Set when Renegociar comes from one row's menu instead of the selection.
  const [renegRowEntry, setRenegRowEntry] = useState<FinancialEntry | null>(null)
  // The entry outlives its dialog so the closing animation keeps its title.
  const [rowAction, setRowAction] = useState<{ dialog: ChargeDialog | null; entry: FinancialEntry; payAll?: boolean } | null>(null)
  const [showFilters, setShowFilters] = useState(false)

  const updateParams = useCallback(
    (changes: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(changes)) {
        if (!value) params.delete(key)
        else params.set(key, value)
      }
      if (!('page' in changes)) params.delete('page')
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [searchParams, router],
  )
  const updateParam = useCallback((key: string, value: string) => updateParams({ [key]: value }), [updateParams])

  const clearFilters = useCallback(() => {
    const params = new URLSearchParams()
    const tab = searchParams.get('tab')
    if (tab) params.set('tab', tab)
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [router, searchParams])

  const statusIsFilter = viewFilter === 'cancelled' || viewFilter === 'renegotiated'
  const panelFilters = [statusIsFilter, isOverdueFilter, dueSoonFilter, receivedThisMonthFilter, isPartialFilter, !defaultPatientId && patientFilter, dateFromFilter, dateToFilter, paymentMethodFilter]
  const activeFilterCount = panelFilters.filter(Boolean).length
  const hasActiveFilters = activeFilterCount > 0

  const totalFilters: Record<ReceivablesTotalKey, boolean> = {
    overdue: isOverdueFilter,
    dueSoon: dueSoonFilter,
    receivedThisMonth: receivedThisMonthFilter,
  }
  const activeTotal = (Object.keys(totalFilters) as ReceivablesTotalKey[]).find((key) => totalFilters[key]) ?? null

  const selectTotal = (key: ReceivablesTotalKey) => {
    const off = activeTotal === key
    updateParams({
      status: key === 'receivedThisMonth' && !off ? setView('all') : '',
      isOverdue: key === 'overdue' && !off ? 'true' : '',
      dueSoon: key === 'dueSoon' && !off ? 'true' : '',
      receivedThisMonth: key === 'receivedThisMonth' && !off ? 'true' : '',
    })
  }

  const filters = {
    status: apiStatus,
    isOverdue: isOverdueFilter || undefined,
    dueSoon: dueSoonFilter || undefined,
    receivedThisMonth: receivedThisMonthFilter || undefined,
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
      if (filters.dueSoon) params.set('dueSoon', 'true')
      if (filters.receivedThisMonth) params.set('receivedThisMonth', 'true')
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

  const entries: FinancialEntry[] = useMemo(() => result?.data ?? [], [result])

  // A selection only ever covers the rows on screen.
  const scopeKey = searchParams.toString()
  const [selectionScope, setSelectionScope] = useState(scopeKey)
  if (selectionScope !== scopeKey) {
    setSelectionScope(scopeKey)
    setSelectedIds(new Set())
  }
  const total = result?.total ?? 0
  const totalPages = result?.totalPages ?? 1

  const groups = useMemo(() => {
    if (apiStatus !== 'open') return [{ bucket: null, entries }]
    return BUCKET_ORDER
      .map((bucket) => ({ bucket, entries: entries.filter((e) => dueBucket(e, todayYmd) === bucket) }))
      .filter((g) => g.entries.length > 0)
  }, [apiStatus, entries, todayYmd])

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

  const stopSelecting = () => {
    setSelecting(false)
    setSelectedIds(new Set())
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

  const canUncancel = useMemo(
    () => selectedEntries.length > 0 && selectedEntries.every((e) => e.status === 'cancelled'),
    [selectedEntries],
  )

  const patientFilterItems = useMemo(
    () => {
      const items: Record<string, string> = { all: 'Todos pacientes' }
      for (const p of patients) items[p.id] = p.fullName
      return items
    },
    [patients],
  )

  const renegotiationEntries = useMemo(
    () =>
      (renegRowEntry ? [renegRowEntry] : renegotiableEntries).map((e) => ({
        id: e.id,
        description: e.description,
        patientName: e.patientName,
        remainingPrincipal: Number(e.remainingPrincipal ?? 0) || (Number(e.totalAmount ?? 0) - Number(e.totalAmountPaid ?? 0)),
        fineAmount: Number(e.totalFineAmount ?? 0),
        interestAmount: Number(e.totalInterestAmount ?? 0),
      })),
    [renegotiableEntries, renegRowEntry],
  )

  const rowEntry = rowAction?.entry
  const rowInstallmentIds = rowAction?.payAll
    ? (rowEntry?.pendingInstallmentIds ?? [])
    : rowEntry?.nextInstallmentId ? [rowEntry.nextInstallmentId] : []
  const rowDetail = (entry: FinancialEntry) => {
    if (rowAction?.payAll) return `${rowInstallmentIds.length} parcelas · ${entry.description}`
    if (entry.installmentCount > 1 && entry.nextInstallmentNumber) {
      return `Parcela ${entry.nextInstallmentNumber} de ${entry.installmentCount} · ${entry.description}`
    }
    return entry.description
  }
  const rowPayee = rowEntry
    ? { patientName: rowEntry.patientName, paymentMethod: rowEntry.paymentMethod, detail: rowDetail(rowEntry) }
    : undefined

  const newChargeButton = (className?: string) => (
    <ReadOnlyGuard label="Nova cobrança">
      <Button
        className={cn('bg-forest text-cream hover:bg-sage transition-colors shadow-sm', className)}
        onClick={() => setShowPaymentForm(true)}
        data-testid="financial-new-charge"
      >
        <PlusIcon className="h-4 w-4" />
        Nova cobrança
      </Button>
    </ReadOnlyGuard>
  )

  return (
    <div className="space-y-3">
      {!defaultPatientId && <ReceivablesTotals active={activeTotal} onSelect={selectTotal} />}

      <div className="flex items-center justify-between gap-2">
        <Tabs value={viewFilter} onValueChange={(v) => updateParams({ status: setView(String(v)), isOverdue: '', dueSoon: '', receivedThisMonth: '' })}>
          <TabsList className="h-11 sm:h-9" aria-label="Cobranças">
            {VIEW_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="px-3 text-xs sm:text-sm" data-testid={`financial-view-${tab.value}`}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="text-xs text-mid tabular-nums">
          {total} {total === 1 ? 'cobrança' : 'cobranças'}
        </span>
      </div>

      {/* Top bar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant={showFilters ? 'default' : 'outline'}
            size="sm"
            className={cn(
              'h-11 sm:h-8',
              showFilters
                ? 'bg-sage text-cream hover:bg-forest'
                : 'border-sage/20 text-mid hover:text-charcoal hover:bg-confirmed-bg'
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

          {canReceive && entries.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-11 text-mid hover:text-charcoal sm:h-8"
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
              data-testid="financial-select-mode"
            >
              {selecting ? 'Concluir' : 'Selecionar'}
            </Button>
          )}

          {hasActiveFilters && (
            <button
              className="min-h-11 px-1 text-xs text-mid hover:text-charcoal transition-colors underline underline-offset-2 sm:min-h-0"
              onClick={clearFilters}
            >
              Limpar
            </button>
          )}
        </div>

        {canReceive && newChargeButton('h-11 sm:h-9')}
      </div>

      {/* Collapsible filters */}
      {showFilters && (
        <div className="rounded-lg border border-sage/15 bg-white p-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-mid">Situação</Label>
              <Select items={STATUS_FILTER_ITEMS} value={viewFilter} onValueChange={(v) => updateParam('status', setView(v || defaultView))}>
                <SelectTrigger className="w-[140px] border-sage/20 h-8 text-sm">
                  <SelectValue placeholder="Situação" />
                </SelectTrigger>
                <SelectContent />
              </Select>
            </div>

            {!defaultPatientId && (
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-mid">Paciente</Label>
                <Select items={patientFilterItems} value={patientFilter || 'all'} onValueChange={(v) => updateParam('patientId', !v || v === 'all' ? '' : v)}>
                  <SelectTrigger className="w-[180px] border-sage/20 h-8 text-sm">
                    <SelectValue placeholder="Paciente" />
                  </SelectTrigger>
                  <SelectContent />
                </Select>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <Label className="text-xs text-mid">Método</Label>
              <Select items={PAYMENT_METHOD_FILTER_ITEMS} value={paymentMethodFilter || 'all'} onValueChange={(v) => updateParam('paymentMethod', !v || v === 'all' ? '' : v)}>
                <SelectTrigger className="w-[150px] border-sage/20 h-8 text-sm">
                  <SelectValue placeholder="Método" />
                </SelectTrigger>
                <SelectContent />
              </Select>
            </div>

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
              <Label className="text-xs text-mid cursor-pointer select-none">Vencidas</Label>
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
      <div className={cn('space-y-2 transition-opacity duration-200', isFetching && !isPending && 'opacity-60')}>
        {selecting && entries.length > 0 && (
          <div className="flex items-center gap-3 px-3 sm:px-4" data-testid="financial-select-all">
            <label className="flex min-h-11 items-center gap-3 sm:min-h-8">
              <Checkbox
                checked={entries.length > 0 && selectedIds.size === entries.length}
                onCheckedChange={toggleSelectAll}
                aria-label="Selecionar todos"
              />
              <span className="text-xs text-mid select-none">
                {selectedIds.size > 0 ? `${selectedIds.size} selecionada${selectedIds.size > 1 ? 's' : ''}` : 'Selecionar todas desta página'}
              </span>
            </label>
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
          <div className="flex flex-col items-center justify-center px-4 py-14 text-center" data-testid="financial-empty">
            <div className="mb-4 rounded-full bg-sage/10 p-4">
              <ReceiptIcon className="h-6 w-6 text-sage" />
            </div>
            {hasActiveFilters ? (
              <>
                <p className="text-sm font-medium text-charcoal">Nenhuma cobrança com esses filtros</p>
                <Button variant="outline" className="mt-4 h-11 sm:h-9" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-charcoal">
                  {viewFilter === 'paid' ? 'Nenhuma cobrança recebida' : apiStatus === 'open' ? 'Nada a receber' : 'Nenhuma cobrança'}
                </p>
                <p className="mt-1 max-w-sm text-xs text-mid">
                  Cobranças nascem de um atendimento ou de um orçamento aprovado. Você também pode lançar uma cobrança avulsa.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {canReceive && newChargeButton('h-11 sm:h-9')}
                  <Link href="/agenda" className={cn(buttonVariants({ variant: 'outline' }), 'h-11 border-sage/30 sm:h-9')}>
                    <CalendarIcon className="h-4 w-4" />
                    Ir para Agenda
                  </Link>
                </div>
              </>
            )}
          </div>
        )}

        {groups.map(({ bucket, entries: groupEntries }) => (
          <section key={bucket ?? 'all'} className="space-y-2" aria-label={bucket ? DUE_BUCKET_LABELS[bucket] : undefined}>
            {bucket && (
              <h3
                className={cn('px-1 pt-2 text-xs font-semibold', DUE_BUCKET_TEXT[bucket])}
              >
                {DUE_BUCKET_LABELS[bucket]}
              </h3>
            )}
            {groupEntries.map((entry) => {
              const fineAmt = Number(entry.totalFineAmount ?? 0)
              const interestAmt = Number(entry.totalInterestAmount ?? 0)
              const penaltyTotal = fineAmt + interestAmt
              const isSelected = selectedIds.has(entry.id)
              const isExpanded = expandedId === entry.id
              const statusKey = entry.isOverdue ? 'overdue' : entry.status
              const statusConf = STATUS_CONFIG[statusKey] ?? STATUS_CONFIG.pending
              const StatusIcon = statusConf.icon
              const progressPercent = entry.installmentCount > 0
                ? Math.round((entry.paidInstallments / entry.installmentCount) * 100)
                : 0
              const renegLinks = entry.renegotiationLinks ?? []
              const isFromRenegotiation = renegLinks.some((l) => l.newEntryId === entry.id)
              const line = dueLine(entry, todayYmd)
              // An open row shows what the patient still owes, fines and interest included.
              const amountShown = OPEN_STATUSES.includes(entry.status) ? entry.openBalance : Number(entry.totalAmount ?? 0)
              const receivable = canReceive && OPEN_STATUSES.includes(entry.status) && entry.nextInstallmentId !== null
              const toggleExpanded = () => setExpandedId(isExpanded ? null : entry.id)

              return (
                <div
                  key={entry.id}
                  data-testid={`financial-entry-${entry.id}`}
                  className={cn(
                    'group rounded-lg border bg-white transition-[border-color,box-shadow] duration-200',
                    isSelected
                      ? 'border-sage/40 ring-1 ring-sage/20 bg-confirmed-bg'
                      : 'border-topbar-border hover:border-sage/25 hover:shadow-sm',
                    isExpanded && 'shadow-md border-sage/30',
                  )}
                >
                  <div className="flex items-center gap-1 py-1 pl-1 pr-1 sm:gap-2 sm:pl-2">
                    {selecting && (
                      <label className="flex size-11 shrink-0 items-center justify-center">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelect(entry.id)}
                          aria-label={`Selecionar ${entry.patientName}, ${entry.description}`}
                        />
                      </label>
                    )}

                    <button
                      type="button"
                      className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 text-left"
                      onClick={toggleExpanded}
                      aria-expanded={isExpanded}
                      data-testid="financial-entry-expand"
                    >
                      <span className={cn('hidden sm:flex items-center justify-center w-8 h-8 rounded-full shrink-0', statusConf.bg)}>
                        <StatusIcon className={cn('h-3.5 w-3.5', statusConf.text)} />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium text-charcoal">{entry.patientName}</span>
                          {/* Phones keep the amount on the name's line so the due line gets the full width */}
                          <span className={cn('shrink-0 text-sm font-semibold tabular-nums sm:hidden', entry.isOverdue ? 'text-red-700' : 'text-charcoal')}>
                            {formatCurrency(amountShown)}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="truncate text-xs text-mid">{entry.description}</span>
                          <span className="hidden shrink-0 text-xs text-mid sm:inline">· criada {formatDate(entry.createdAt)}</span>
                          {isFromRenegotiation && (
                            <span className="shrink-0 text-[10px] font-medium text-blue-600">Renegociação</span>
                          )}
                        </span>
                        <span className={cn('mt-0.5 block text-xs font-medium sm:truncate', line.className)} data-testid="financial-entry-due">
                          {line.text}
                        </span>
                      </span>

                      {entry.installmentCount > 1 && (
                        <span className="hidden w-16 shrink-0 flex-col items-center gap-1 sm:flex">
                          <span className="h-1 w-full overflow-hidden rounded-full bg-topbar-border">
                            <span
                              className={cn(
                                'block h-full rounded-full transition-[width] duration-500',
                                progressPercent >= 100 ? 'bg-emerald-400' : progressPercent > 0 ? 'bg-amber-400' : 'bg-transparent'
                              )}
                              style={{ width: `${progressPercent}%` }}
                            />
                          </span>
                          <span className="text-[10px] text-mid tabular-nums">
                            {entry.paidInstallments}/{entry.installmentCount} pagas
                          </span>
                        </span>
                      )}

                      {penaltyTotal > 0 && (
                        <span className="hidden md:flex flex-col items-end shrink-0">
                          {fineAmt > 0 && (
                            <span className="text-[10px] text-amber-700 tabular-nums">Multa {formatCurrency(fineAmt)}</span>
                          )}
                          {interestAmt > 0 && (
                            <span className="text-[10px] text-amber-700 tabular-nums">Juros {formatCurrency(interestAmt)}</span>
                          )}
                        </span>
                      )}

                      <span
                        className={cn(
                          'hidden shrink-0 text-right text-sm font-semibold tabular-nums sm:block sm:w-28',
                          entry.isOverdue ? 'text-red-700' : 'text-charcoal',
                        )}
                      >
                        {formatCurrency(amountShown)}
                      </span>
                    </button>

                    {receivable ? (
                      <Button
                        size="sm"
                        className="h-11 shrink-0 bg-forest px-3 text-cream hover:bg-sage active:scale-[0.97] transition-[background-color,transform] duration-150 sm:h-8"
                        onClick={guard(() => setRowAction({ dialog: 'pay', entry }))}
                        data-testid="financial-entry-receive"
                      >
                        Receber
                      </Button>
                    ) : (
                      <span className="hidden w-[4.75rem] shrink-0 sm:block" aria-hidden />
                    )}

                    <ChargeRowMenu
                      entry={entry}
                      onDialog={(dialog) => setRowAction({ dialog, entry })}
                      onRenegotiate={() => {
                        setRenegRowEntry(entry)
                        setRenegDialogOpen(true)
                      }}
                      onPayAll={guard(() => setRowAction({ dialog: 'pay', entry, payAll: true }))}
                    />
                  </div>

                  {isExpanded && (
                    <div className="border-t border-sage/10 bg-content-bg/50 px-4 py-4 rounded-b-lg animate-in fade-in slide-in-from-top-1 duration-200">
                      <InstallmentTable entryId={entry.id} onPaymentComplete={fetchEntries} />
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="h-11 border-sage/20 text-charcoal hover:bg-confirmed-bg transition-colors sm:h-8"
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
            className="h-11 border-sage/20 text-charcoal hover:bg-confirmed-bg transition-colors sm:h-8"
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
        canUncancel={canUncancel}
        onClear={() => setSelectedIds(new Set())}
        onRenegotiate={() => {
          setRenegRowEntry(null)
          setRenegDialogOpen(true)
        }}
        onSuccess={fetchEntries}
      />

      {/* One charge's actions: Receber pays its next installment */}
      <ChargeActionDialogs
        dialog={rowAction?.dialog ?? null}
        onDialogChange={(dialog) => setRowAction((prev) => (prev ? { ...prev, dialog } : null))}
        installmentIds={rowInstallmentIds}
        entryIds={rowEntry ? [rowEntry.id] : []}
        payee={rowPayee}
        onSuccess={fetchEntries}
      />

      {/* Renegotiation dialog */}
      {renegDialogOpen && renegotiationEntries.length > 0 && (
        <RenegotiationDialog
          open={renegDialogOpen}
          onOpenChange={(open) => {
            setRenegDialogOpen(open)
            if (!open) setRenegRowEntry(null)
          }}
          entries={renegotiationEntries}
          onSuccess={() => {
            if (!renegRowEntry) setSelectedIds(new Set())
            setRenegRowEntry(null)
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
