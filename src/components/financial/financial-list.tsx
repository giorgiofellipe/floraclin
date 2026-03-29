'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
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
import { formatCurrency, formatDate } from '@/lib/utils'
import { listFinancialEntriesAction } from '@/actions/financial'
import { InstallmentTable } from './installment-table'
import { PaymentForm } from './payment-form'
import { ChevronRightIcon, PlusIcon } from 'lucide-react'

interface Patient {
  id: string
  fullName: string
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
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  partial: 'Parcial',
  paid: 'Pago',
  overdue: 'Atrasado',
  cancelled: 'Cancelado',
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-[#FFF4EF] text-amber',
  partial: 'bg-[#FFF4EF] text-amber',
  paid: 'bg-[#F0F7F1] text-sage',
  overdue: 'bg-[#FFF4EF] text-amber-dark',
  cancelled: 'bg-white text-mid',
}

export function FinancialList({ patients }: { patients: Patient[] }) {
  const [entries, setEntries] = useState<FinancialEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [isPending, startTransition] = useTransition()

  const fetchEntries = useCallback(() => {
    startTransition(async () => {
      const result = await listFinancialEntriesAction({
        status: statusFilter || undefined,
        page,
        limit: 20,
      })

      if (result.data) {
        setEntries(result.data.data as FinancialEntry[])
        setTotal(result.data.total)
        setTotalPages(result.data.totalPages)
      }
    })
  }, [statusFilter, page])

  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  const handleStatusChange = (value: string | null) => {
    setStatusFilter(!value || value === 'all' ? '' : value)
    setPage(1)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Select value={statusFilter || 'all'} onValueChange={handleStatusChange}>
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
              <SelectItem value="partial">Parcial</SelectItem>
              <SelectItem value="paid">Pago</SelectItem>
              <SelectItem value="overdue">Atrasado</SelectItem>
              <SelectItem value="cancelled">Cancelado</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-mid">
            {total} {total === 1 ? 'registro' : 'registros'}
          </span>
        </div>
        <Button className="bg-forest text-cream hover:bg-sage transition-colors" onClick={() => setShowPaymentForm(true)}>
          <PlusIcon data-icon="inline-start" />
          Nova Cobrança
        </Button>
      </div>

      <div className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-white border-b border-[#E8ECEF] hover:bg-white">
              <TableHead className="w-8" />
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Paciente</TableHead>
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
                  ) : 'Nenhuma cobrança registrada.'}
                </TableCell>
              </TableRow>
            )}
            {entries.map((entry) => (
              <TableRow
                key={entry.id}
                className="cursor-pointer transition-colors hover:bg-[#F4F6F8] border-b border-[#E8ECEF]"
                onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              >
                <TableCell className="text-mid">
                  <div className={`transition-transform duration-200 ${expandedId === entry.id ? 'rotate-90' : ''}`}>
                    <ChevronRightIcon className="size-4" />
                  </div>
                </TableCell>
                <TableCell className="font-medium text-charcoal">{entry.patientName}</TableCell>
                <TableCell className="text-charcoal">{entry.description}</TableCell>
                <TableCell className={`text-right font-medium tabular-nums ${entry.status === 'overdue' ? 'text-amber' : 'text-charcoal'}`}>
                  {formatCurrency(Number(entry.totalAmount))}
                </TableCell>
                <TableCell className="text-center">
                  <span className="text-sm tabular-nums text-mid">
                    {entry.paidInstallments}/{entry.installmentCount}
                  </span>
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${STATUS_COLORS[entry.status] ?? 'bg-white text-mid'}`}>
                    {STATUS_LABELS[entry.status] ?? entry.status}
                  </span>
                </TableCell>
                <TableCell className="text-mid text-sm">{formatDate(entry.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {expandedId && (
        <div className="rounded-[3px] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-top-2 duration-200">
          <InstallmentTable entryId={expandedId} onPaymentComplete={fetchEntries} />
        </div>
      )}

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
