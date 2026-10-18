'use client'

import { useMemo, useState } from 'react'
import { useCardRepasses } from '@/hooks/queries/use-card-repasses'
import { useCardTerminals } from '@/hooks/queries/use-card-terminals'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { brToday } from '@/lib/dates'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { DateRangePicker } from '@/components/ui/date-picker'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AdjustRepasseDialog } from './adjust-repasse-dialog'
import type { CardRepasseListRow } from '@/db/queries/card-payments'

const PAGE_SIZE = 30

const STATUS_LABELS: Record<string, string> = {
  pending: 'Aguardando repasse',
  received: 'Recebido',
  cancelled: 'Cancelado',
}

const STATUS_FILTER_ITEMS: Record<string, string> = { all: 'Todos', ...STATUS_LABELS }

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-blush text-gold',
  received: 'bg-[#F0F7F1] text-[#4A6B52]',
  cancelled: 'bg-[#F4F6F8] text-mid',
}

const TH = 'px-4 py-3 text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] font-medium'

export function CardRepassesView() {
  const today = useMemo(() => brToday(), [])
  const [dateFrom, setDateFrom] = useState(`${today.slice(0, 7)}-01`)
  const [dateTo, setDateTo] = useState(today)
  const [terminalId, setTerminalId] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [adjusting, setAdjusting] = useState<CardRepasseListRow | null>(null)

  const { data, isPending, isFetching } = useCardRepasses({
    dateFrom,
    dateTo,
    terminalId: terminalId || undefined,
    status: (status || undefined) as 'pending' | 'received' | 'cancelled' | undefined,
    page,
    limit: PAGE_SIZE,
  })
  const { data: terminals } = useCardTerminals()

  const terminalItems = useMemo(() => {
    const items: Record<string, string> = { all: 'Todas' }
    for (const t of terminals?.data ?? []) items[t.id] = t.name
    return items
  }, [terminals])

  const rows = data?.data ?? []
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE))

  return (
    <div className="space-y-6">
      <div className="rounded-[3px] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <p className="text-xs uppercase tracking-wider font-medium text-mid">A receber das maquininhas</p>
        <p className="mt-1 text-2xl font-bold text-charcoal tabular-nums tracking-tight" data-testid="pending-net-total">
          {formatCurrency(data?.pendingNetTotal ?? 0)}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={(v) => { setDateFrom(v); setPage(1) }}
          onDateToChange={(v) => { setDateTo(v); setPage(1) }}
        />
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-mid">Maquininha</Label>
          <Select
            items={terminalItems}
            value={terminalId || 'all'}
            onValueChange={(v) => { setTerminalId(!v || v === 'all' ? '' : v); setPage(1) }}
          >
            <SelectTrigger className="w-[180px] border-sage/20">
              <SelectValue placeholder="Maquininha" />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-mid">Status</Label>
          <Select
            items={STATUS_FILTER_ITEMS}
            value={status || 'all'}
            onValueChange={(v) => { setStatus(!v || v === 'all' ? '' : v); setPage(1) }}
          >
            <SelectTrigger className="w-[190px] border-sage/20">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>
      </div>

      <div className={cn('rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden transition-opacity duration-200', isFetching && !isPending && 'opacity-60')}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E8ECEF]">
                <th className={cn(TH, 'text-left')}>Data prevista</th>
                <th className={cn(TH, 'text-left')}>Maquininha</th>
                <th className={cn(TH, 'text-left')}>Paciente</th>
                <th className={cn(TH, 'text-right')}>Bruto</th>
                <th className={cn(TH, 'text-right')}>Taxa</th>
                <th className={cn(TH, 'text-right')}>Líquido</th>
                <th className={cn(TH, 'text-left')}>Status</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {isPending && (
                <tr>
                  <td colSpan={8} className="text-center text-mid py-12">Carregando repasses...</td>
                </tr>
              )}
              {!isPending && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-mid py-12">
                    Nenhum repasse encontrado no período.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[#E8ECEF] last:border-b-0 hover:bg-[#F4F6F8] transition-colors">
                  <td className="px-4 py-3 text-charcoal whitespace-nowrap">{formatDate(r.expectedDate)}</td>
                  <td className="px-4 py-3 text-charcoal">{r.terminalName}</td>
                  <td className="px-4 py-3 text-charcoal">{r.patientName}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-charcoal">{formatCurrency(Number(r.grossAmount))}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-mid">{formatCurrency(Number(r.feeAmount))}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-charcoal">{formatCurrency(Number(r.netAmount))}</td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_STYLES[r.status])}>
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.status !== 'cancelled' && (
                      <Button variant="ghost" size="sm" className="text-mid hover:text-charcoal" onClick={() => setAdjusting(r)}>
                        Ajustar repasse
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button variant="outline" size="sm" className="border-sage/30 text-charcoal" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <span className="text-sm text-mid tabular-nums">Página {page} de {totalPages}</span>
          <Button variant="outline" size="sm" className="border-sage/30 text-charcoal" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Próxima
          </Button>
        </div>
      )}

      {adjusting && (
        <AdjustRepasseDialog
          key={adjusting.id}
          open
          onOpenChange={(open) => { if (!open) setAdjusting(null) }}
          repasse={adjusting}
        />
      )}
    </div>
  )
}
