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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatCurrency, formatDate } from '@/lib/utils'
import { listFinancialEntriesAction } from '@/actions/financial'
import { InstallmentTable } from './installment-table'
import { PaymentForm } from './payment-form'
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from 'lucide-react'
import type { FinancialStatus } from '@/types'

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

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  partial: 'secondary',
  paid: 'default',
  overdue: 'destructive',
  cancelled: 'outline',
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
        <div className="flex items-center gap-2">
          <Select value={statusFilter || 'all'} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status" />
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
          <span className="text-sm text-muted-foreground">
            {total} {total === 1 ? 'registro' : 'registros'}
          </span>
        </div>
        <Button onClick={() => setShowPaymentForm(true)}>
          <PlusIcon data-icon="inline-start" />
          Nova Cobrança
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Paciente</TableHead>
            <TableHead>Descrição</TableHead>
            <TableHead>Valor</TableHead>
            <TableHead>Parcelas</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Data</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                {isPending ? 'Carregando...' : 'Nenhuma cobrança registrada.'}
              </TableCell>
            </TableRow>
          )}
          {entries.map((entry) => (
            <TableRow
              key={entry.id}
              className="cursor-pointer"
              onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
            >
              <TableCell>
                {expandedId === entry.id ? (
                  <ChevronDownIcon className="size-4" />
                ) : (
                  <ChevronRightIcon className="size-4" />
                )}
              </TableCell>
              <TableCell className="font-medium">{entry.patientName}</TableCell>
              <TableCell>{entry.description}</TableCell>
              <TableCell>{formatCurrency(Number(entry.totalAmount))}</TableCell>
              <TableCell>
                {entry.paidInstallments}/{entry.installmentCount}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANTS[entry.status] ?? 'outline'}>
                  {STATUS_LABELS[entry.status] ?? entry.status}
                </Badge>
              </TableCell>
              <TableCell>{formatDate(entry.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {expandedId && (
        <div className="rounded-lg border p-4">
          <InstallmentTable entryId={expandedId} onPaymentComplete={fetchEntries} />
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
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
