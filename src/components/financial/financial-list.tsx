'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { queryKeys } from '@/hooks/queries/query-keys'
import { InstallmentTable } from './installment-table'
import { PaymentForm } from './payment-form'
import { PenaltyBadge } from './penalty-badge'
import { BulkActionBar } from './bulk-action-bar'
import { RenegotiationDialog } from './renegotiation-dialog'
import { ChevronRightIcon, PlusIcon, XIcon, FilterIcon } from 'lucide-react'

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
  // Penalty / partial payment fields
  totalFineAmount?: number
  totalInterestAmount?: number
  totalAmountPaid?: number
  isOverdue?: boolean
  isPartial?: boolean
  // Renegotiation
  renegotiatedAt?: string | null
  renegotiationLinks?: RenegotiationLink[]
  // For bulk operations
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

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-[#FFF4EF] text-amber',
  partial: 'bg-[#FFF4EF] text-amber',
  paid: 'bg-[#F0F7F1] text-sage',
  overdue: 'bg-[#FFF4EF] text-amber-dark',
  cancelled: 'bg-white text-mid',
  renegotiated: 'bg-blue-50 text-blue-700',
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'PIX',
  credit_card: 'Cartao de Credito',
  debit_card: 'Cartao de Debito',
  cash: 'Dinheiro',
  transfer: 'Transferencia',
}

export function FinancialList({ patients }: { patients: Patient[] }) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const searchParams = useSearchParams()

  // Read filters from URL
  const statusFilter = searchParams.get('status') ?? ''
  const isOverdueFilter = searchParams.get('isOverdue') === 'true'
  const isPartialFilter = searchParams.get('isPartial') === 'true'
  const patientFilter = searchParams.get('patientId') ?? ''
  const dateFromFilter = searchParams.get('dateFrom') ?? ''
  const dateToFilter = searchParams.get('dateTo') ?? ''
  const paymentMethodFilter = searchParams.get('paymentMethod') ?? ''
  const page = parseInt(searchParams.get('page') ?? '1', 10)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [renegDialogOpen, setRenegDialogOpen] = useState(false)

  // Update URL search params
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

  const { data: result, isPending } = useQuery({
    queryKey: queryKeys.financial.entries(filters as Record<string, unknown>),
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

  // Selection helpers
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === entries.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(entries.map((e) => e.id)))
    }
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

  // Renegotiation data
  const renegotiationEntries = useMemo(
    () =>
      selectedEntries.map((e) => ({
        id: e.id,
        description: e.description,
        patientName: e.patientName,
        remainingPrincipal: e.remainingPrincipal ?? Number(e.totalAmount) - (e.totalAmountPaid ?? 0),
        fineAmount: e.totalFineAmount ?? 0,
        interestAmount: e.totalInterestAmount ?? 0,
      })),
    [selectedEntries],
  )

  return (
    <div className="space-y-4">
      {/* Top bar: filters + new button */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Status */}
          <Select value={statusFilter || 'all'} onValueChange={(v) => updateParam('status', !v || v === 'all' ? '' : v)}>
            <SelectTrigger className="w-[160px] border-sage/20">
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
              <SelectItem value="renegotiated">Renegociado</SelectItem>
            </SelectContent>
          </Select>

          {/* isOverdue toggle */}
          <div className="flex items-center gap-2">
            <Switch
              checked={isOverdueFilter}
              onCheckedChange={(checked) => updateParam('isOverdue', checked ? 'true' : '')}
              size="sm"
            />
            <Label className="text-xs text-mid cursor-pointer">Atrasados</Label>
          </div>

          {/* isPartial toggle */}
          <div className="flex items-center gap-2">
            <Switch
              checked={isPartialFilter}
              onCheckedChange={(checked) => updateParam('isPartial', checked ? 'true' : '')}
              size="sm"
            />
            <Label className="text-xs text-mid cursor-pointer">Parciais</Label>
          </div>

          {/* Patient select */}
          <Select value={patientFilter || 'all'} onValueChange={(v) => updateParam('patientId', !v || v === 'all' ? '' : v)}>
            <SelectTrigger className="w-[180px] border-sage/20">
              <SelectValue placeholder="Paciente">
                {(value: string) => {
                  if (value === 'all') return 'Todos pacientes'
                  return patients.find((p) => p.id === value)?.fullName ?? 'Paciente'
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos pacientes</SelectItem>
              {patients.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.fullName}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Date range */}
          <div className="flex items-center gap-1">
            <Input
              type="date"
              value={dateFromFilter}
              onChange={(e) => updateParam('dateFrom', e.target.value)}
              className="w-[140px] h-8 text-sm"
              placeholder="De"
            />
            <span className="text-mid text-xs">a</span>
            <Input
              type="date"
              value={dateToFilter}
              onChange={(e) => updateParam('dateTo', e.target.value)}
              className="w-[140px] h-8 text-sm"
              placeholder="Ate"
            />
          </div>

          {/* Payment method */}
          <Select value={paymentMethodFilter || 'all'} onValueChange={(v) => updateParam('paymentMethod', !v || v === 'all' ? '' : v)}>
            <SelectTrigger className="w-[160px] border-sage/20">
              <SelectValue placeholder="Metodo">
                {(value: string) => {
                  if (value === 'all') return 'Todos metodos'
                  return PAYMENT_METHOD_LABELS[value] ?? value
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos metodos</SelectItem>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Clear filters */}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="text-mid hover:text-charcoal"
              onClick={clearFilters}
            >
              <XIcon data-icon="inline-start" />
              Limpar filtros
            </Button>
          )}

          <span className="text-sm text-mid">
            {total} {total === 1 ? 'registro' : 'registros'}
          </span>
        </div>

        <Button className="bg-forest text-cream hover:bg-sage transition-colors" onClick={() => setShowPaymentForm(true)}>
          <PlusIcon data-icon="inline-start" />
          Nova Cobranca
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-white border-b border-[#E8ECEF] hover:bg-white">
              <TableHead className="w-10">
                <Checkbox
                  checked={entries.length > 0 && selectedIds.size === entries.length}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Selecionar todos"
                />
              </TableHead>
              <TableHead className="w-8" />
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Paciente</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Descricao</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] text-right">Valor</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] text-center">Parcelas</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Status</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Encargos</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Data</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-mid py-12">
                  {isPending ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="size-2 animate-pulse rounded-full bg-sage" />
                      Carregando...
                    </span>
                  ) : 'Nenhuma cobranca registrada.'}
                </TableCell>
              </TableRow>
            )}
            {entries.map((entry) => {
              const fineAmt = entry.totalFineAmount ?? 0
              const interestAmt = entry.totalInterestAmount ?? 0
              const isSelected = selectedIds.has(entry.id)

              // Renegotiation link info
              const renegLinks = entry.renegotiationLinks ?? []
              const wasRenegotiated = entry.status === 'renegotiated'
              const isFromRenegotiation = renegLinks.some((l) => l.newEntryId === entry.id)

              return (
                <TableRow
                  key={entry.id}
                  className={cn(
                    'cursor-pointer transition-colors border-b border-[#E8ECEF]',
                    isSelected ? 'bg-[#F0F7F1]' : 'hover:bg-[#F4F6F8]',
                  )}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleSelect(entry.id)}
                      aria-label={`Selecionar ${entry.description}`}
                    />
                  </TableCell>
                  <TableCell
                    className="text-mid"
                    onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  >
                    <div className={cn('transition-transform duration-200', expandedId === entry.id && 'rotate-90')}>
                      <ChevronRightIcon className="size-4" />
                    </div>
                  </TableCell>
                  <TableCell
                    className="font-medium text-charcoal"
                    onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  >
                    {entry.patientName}
                  </TableCell>
                  <TableCell
                    className="text-charcoal"
                    onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  >
                    <div>
                      {entry.description}
                      {/* Renegotiation links */}
                      {wasRenegotiated && renegLinks.length > 0 && (
                        <span className="block text-xs text-blue-600 mt-0.5">
                          Renegociado → #{renegLinks.find((l) => l.originalEntryId === entry.id)?.newEntryId?.slice(0, 8) ?? '...'}
                        </span>
                      )}
                      {isFromRenegotiation && (
                        <span className="block text-xs text-blue-600 mt-0.5">
                          Renegociacao de{' '}
                          {renegLinks
                            .filter((l) => l.newEntryId === entry.id)
                            .map((l) => `#${l.originalEntryId.slice(0, 8)}`)
                            .join(', ')}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell
                    className={cn('text-right font-medium tabular-nums', entry.isOverdue ? 'text-amber-700' : 'text-charcoal')}
                    onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  >
                    {formatCurrency(Number(entry.totalAmount))}
                  </TableCell>
                  <TableCell
                    className="text-center"
                    onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  >
                    <span className="text-sm tabular-nums text-mid">
                      {entry.paidInstallments}/{entry.installmentCount}
                    </span>
                  </TableCell>
                  <TableCell
                    onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  >
                    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium', STATUS_COLORS[entry.status] ?? 'bg-white text-mid')}>
                      {STATUS_LABELS[entry.status] ?? entry.status}
                    </span>
                  </TableCell>
                  <TableCell
                    onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  >
                    <PenaltyBadge
                      fineAmount={fineAmt}
                      interestAmount={interestAmt}
                      isPaid={entry.status === 'paid'}
                    />
                  </TableCell>
                  <TableCell
                    className="text-mid text-sm"
                    onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  >
                    {formatDate(entry.createdAt)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Expanded installment table */}
      {expandedId && (
        <div className="rounded-[3px] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-top-2 duration-200">
          <InstallmentTable entryId={expandedId} onPaymentComplete={fetchEntries} />
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
            onClick={() => updateParam('page', String(page - 1))}
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
            onClick={() => updateParam('page', String(page + 1))}
          >
            Proxima
          </Button>
        </div>
      )}

      {/* Bulk action bar */}
      <BulkActionBar
        selectedCount={selectedIds.size}
        selectedInstallmentIds={selectedInstallmentIds}
        selectedEntryIds={selectedEntryIds}
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
          patients={patients}
          open={showPaymentForm}
          onClose={() => setShowPaymentForm(false)}
          onSuccess={() => {
            setShowPaymentForm(false)
            fetchEntries()
          }}
        />
      )}
    </div>
  )
}
