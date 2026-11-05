'use client'

import { useMemo, useState } from 'react'
import { DownloadIcon, FilterXIcon, Loader2Icon, MoreHorizontalIcon, RotateCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatCurrency } from '@/lib/utils'
import { brToday, formatBrDate, formatBrTime } from '@/lib/dates'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { DateRangePicker } from '@/components/ui/date-picker'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSubscriptionAccess } from '@/components/layout/subscription-access'
import { useFinancialPatients } from '@/hooks/queries/use-financial'
import {
  nfseDocumentsExportUrl,
  useNfseDocuments,
  useResendNfseEmail,
  type NfseDocumentsFilters,
} from '@/hooks/queries/use-nfse-documents'
import type { NfseDocumentListItem, NfseDocumentStatus, NfseListStatus } from '@/lib/nfse/types'
import { CancelNfseDialog } from './cancel-nfse-dialog'
import { useNfsePrompt } from './nfse-prompt-provider'
import { nfseStatusChip } from './status-labels'

const PAGE_SIZE = 30
const CANCEL_ROLES = ['owner', 'financial']
const EXPORT_ROLES = ['owner', 'financial']

const STATUS_FILTER_ITEMS: Record<'all' | NfseListStatus, string> = {
  all: 'Todos',
  issued: 'Emitidas',
  cancelled: 'Canceladas',
  failed: 'Com falha',
  processing: 'Em processamento',
}

function openDocument(id: string, format: 'pdf' | 'xml') {
  window.open(`/api/nfse/${id}/${format}`, '_blank', 'noopener,noreferrer')
}

function emittedAt(doc: NfseDocumentListItem): string {
  const at = doc.issuedAt ?? doc.createdAt
  return `${formatBrDate(at)} ${formatBrTime(at)}`
}

const HEADER_CLASS = 'px-4 py-3 text-left text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] font-medium'

export function NfseDocumentsList() {
  const today = brToday()
  const { role } = useSubscriptionAccess()
  const { openEmit } = useNfsePrompt()
  const resend = useResendNfseEmail()
  const [dateFrom, setDateFrom] = useState(`${today.slice(0, 8)}01`)
  const [dateTo, setDateTo] = useState(today)
  const [status, setStatus] = useState<NfseListStatus | ''>('')
  const [patientId, setPatientId] = useState('')
  const [page, setPage] = useState(1)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const filters: NfseDocumentsFilters = {
    dateFrom,
    dateTo,
    status: status || undefined,
    patientId: patientId || undefined,
  }
  const { data, isPending, isFetching } = useNfseDocuments({ ...filters, page, limit: PAGE_SIZE })
  const { data: patients } = useFinancialPatients()

  const patientFilterItems = useMemo(() => {
    const items: Record<string, string> = { all: 'Todos' }
    for (const p of (patients ?? []) as { id: string; fullName: string }[]) items[p.id] = p.fullName
    return items
  }, [patients])

  const canCancel = CANCEL_ROLES.includes(role)
  const canExport = EXPORT_ROLES.includes(role)
  const documents = data?.data ?? []
  const totalPages = data?.totalPages ?? 1

  function resetPage<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value)
      setPage(1)
    }
  }

  async function handleResend(id: string) {
    try {
      await resend.mutateAsync(id)
      toast.success('Email enviado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao reenviar o email')
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      const res = await fetch(nfseDocumentsExportUrl(filters))
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Erro ao exportar as notas')
      }
      const url = URL.createObjectURL(await res.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `notas-fiscais-${dateFrom}-a-${dateTo}.zip`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao exportar as notas')
    } finally {
      setExporting(false)
    }
  }

  const hasActiveFilters = status !== '' || patientId !== ''

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={resetPage(setDateFrom)}
          onDateToChange={resetPage(setDateTo)}
        />

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-mid">Status</Label>
          <Select
            items={STATUS_FILTER_ITEMS}
            value={status || 'all'}
            onValueChange={(v) => resetPage(setStatus)(!v || v === 'all' ? '' : (v as NfseListStatus))}
          >
            <SelectTrigger className="w-[170px] border-sage/20" aria-label="Status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-mid">Paciente</Label>
          <Select
            items={patientFilterItems}
            value={patientId || 'all'}
            onValueChange={(v) => resetPage(setPatientId)(!v || v === 'all' ? '' : v)}
          >
            <SelectTrigger className="w-[180px] border-sage/20" aria-label="Paciente">
              <SelectValue placeholder="Paciente" />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="text-mid hover:text-charcoal"
            onClick={() => {
              setStatus('')
              setPatientId('')
              setPage(1)
            }}
          >
            <FilterXIcon data-icon="inline-start" />
            Limpar filtros
          </Button>
        )}

        {canExport && (
          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors"
              disabled={exporting}
              onClick={handleExport}
            >
              {exporting ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />}
              Exportar XML (ZIP)
            </Button>
          </div>
        )}
      </div>

      <div
        className={cn(
          'rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden transition-opacity duration-200',
          isFetching && !isPending && 'opacity-60',
        )}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E8ECEF]">
                <th className={HEADER_CLASS}>Nº</th>
                <th className={HEADER_CLASS}>Emissão</th>
                <th className={HEADER_CLASS}>Paciente</th>
                <th className={cn(HEADER_CLASS, 'text-right')}>Valor</th>
                <th className={HEADER_CLASS}>Status</th>
                <th className={cn(HEADER_CLASS, 'text-right')}>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {isPending && (
                <tr>
                  <td colSpan={6} className="text-center text-mid py-12">
                    <span className="flex items-center justify-center gap-2">
                      <span className="size-2 animate-pulse rounded-full bg-sage" />
                      Carregando notas fiscais...
                    </span>
                  </td>
                </tr>
              )}
              {!isPending && documents.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-mid py-12">
                    Nenhuma nota fiscal no período.
                  </td>
                </tr>
              )}
              {documents.map((doc) => {
                const chip = nfseStatusChip(doc)
                const hasFiles = doc.status === 'issued' || doc.status === 'cancelled'
                const canCancelDoc = canCancel && doc.status === 'issued'
                return (
                  <tr
                    key={doc.id}
                    data-testid="nfse-document-row"
                    className="border-b border-[#E8ECEF] last:border-b-0 hover:bg-[#F4F6F8] transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-charcoal tabular-nums">{doc.nfseNumber ?? '-'}</td>
                    <td className="px-4 py-3 text-charcoal whitespace-nowrap tabular-nums">{emittedAt(doc)}</td>
                    <td className="px-4 py-3 text-charcoal">{doc.patientName}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-charcoal">
                      {formatCurrency(doc.value)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', chip.className)}>
                        {chip.label}
                      </span>
                      {doc.status === 'failed' && doc.errorMessage && (
                        <p className="mt-1 max-w-xs text-xs text-mid">{doc.errorMessage}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {doc.retryable && (
                          <Button size="sm" variant="outline" onClick={() => openEmit([doc.paymentRecordId])}>
                            <RotateCwIcon data-icon="inline-start" />
                            Tentar de novo
                          </Button>
                        )}
                        {hasFiles && (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button size="sm" variant="ghost" aria-label="Ações da nota">
                                  <MoreHorizontalIcon />
                                </Button>
                              }
                            />
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openDocument(doc.id, 'pdf')}>Ver PDF</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openDocument(doc.id, 'xml')}>Baixar XML</DropdownMenuItem>
                              {doc.status === 'issued' && (
                                <DropdownMenuItem onClick={() => handleResend(doc.id)}>Reenviar email</DropdownMenuItem>
                              )}
                              {canCancelDoc && (
                                <DropdownMenuItem onClick={() => setCancelId(doc.id)}>
                                  {doc.cancelRequested ? 'Tentar cancelar de novo' : 'Cancelar NFS-e'}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

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
            Página {page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      )}

      {cancelId && (
        <CancelNfseDialog
          documentId={cancelId}
          open
          onOpenChange={(open) => {
            if (!open) setCancelId(null)
          }}
        />
      )}
    </div>
  )
}
