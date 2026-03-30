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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useFinancialEntries } from '@/hooks/queries/use-financial'
import { useInvalidation } from '@/hooks/queries/use-invalidation'
import { InstallmentTable } from '@/components/financial/installment-table'
import { PaymentForm } from '@/components/financial/payment-form'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  Plus,
  Wallet,
} from 'lucide-react'

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

interface PatientFinancialTabProps {
  patientId: string
  patientName: string
}

export function PatientFinancialTab({ patientId, patientName }: PatientFinancialTabProps) {
  const { data: rawData, isLoading } = useFinancialEntries({ patientId })
  const { invalidateFinancial } = useInvalidation()
  const entries = (rawData?.data ?? []) as FinancialEntry[]
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showPaymentForm, setShowPaymentForm] = useState(false)

  const patients = [{ id: patientId, fullName: patientName }]

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-sm text-mid">Carregando financeiro...</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-mid">
          {entries.length} {entries.length === 1 ? 'cobrança' : 'cobranças'}
        </p>
        <Button onClick={() => setShowPaymentForm(true)}>
          <Plus className="size-4 mr-1" />
          Nova Cobrança
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-mid">
          <Wallet className="mb-2 size-8" />
          <p className="text-sm">Nenhuma cobrança registrada</p>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Descricao</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Parcelas</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow
                  key={entry.id}
                  className="cursor-pointer"
                  onClick={() =>
                    setExpandedId(expandedId === entry.id ? null : entry.id)
                  }
                >
                  <TableCell>
                    {expandedId === entry.id ? (
                      <ChevronDownIcon className="size-4" />
                    ) : (
                      <ChevronRightIcon className="size-4" />
                    )}
                  </TableCell>
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
            <div className="rounded-[3px] border p-4">
              <InstallmentTable
                entryId={expandedId}
                onPaymentComplete={() => invalidateFinancial()}
              />
            </div>
          )}
        </>
      )}

      {showPaymentForm && (
        <PaymentForm
          patients={patients}
          open={showPaymentForm}
          onClose={() => setShowPaymentForm(false)}
          onSuccess={() => {
            setShowPaymentForm(false)
            invalidateFinancial()
          }}
        />
      )}
    </div>
  )
}
