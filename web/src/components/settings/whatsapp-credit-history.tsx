'use client'

import { useMemo, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useWhatsAppCreditLedger } from '@/hooks/queries/use-whatsapp-credit-ledger'
import { BR_TZ, parseBrDate, toBrYmd } from '@/lib/dates'
import { UNLIMITED_CREDITS } from '@/lib/whatsapp-credits'
import { describeLedgerEntry, type LedgerEntry, type LedgerPeriod } from '@/lib/whatsapp-credit-ledger'

function groupByBrDay(entries: LedgerEntry[]) {
  const groups: { ymd: string; entries: LedgerEntry[] }[] = []
  for (const e of entries) {
    const ymd = toBrYmd(new Date(e.createdAt))
    const last = groups.at(-1)
    if (last?.ymd === ymd) last.entries.push(e)
    else groups.push({ ymd, entries: [e] })
  }
  return groups
}

// The period end is exclusive, so step back 1ms to show the last day.
const formatPeriod = (p: LedgerPeriod) =>
  `${formatInTimeZone(new Date(p.start), BR_TZ, 'dd/MM')} a ${formatInTimeZone(new Date(new Date(p.end).getTime() - 1), BR_TZ, 'dd/MM/yyyy')}`

function usageLabel(p: LedgerPeriod) {
  return p.total === UNLIMITED_CREDITS
    ? `${p.used} créditos usados (ilimitado)`
    : `${p.used} de ${p.total} créditos usados`
}

function LedgerLine({ entry }: { entry: LedgerEntry }) {
  const amountText = entry.amount > 0 ? `+${entry.amount}` : String(entry.amount)
  const amountColor = entry.amount > 0 ? 'text-emerald-600' : 'text-red-600'
  return (
    <li className="flex items-start gap-3 py-2">
      <time dateTime={entry.createdAt} className="shrink-0 text-xs text-mid tabular-nums pt-0.5">
        {formatInTimeZone(new Date(entry.createdAt), BR_TZ, 'HH:mm')}
      </time>
      <p className="min-w-0 flex-1 break-words text-sm text-charcoal">
        {describeLedgerEntry(entry).map((part, i) =>
          part.strong ? <strong key={i}>{part.text}</strong> : <span key={i}>{part.text}</span>,
        )}
      </p>
      <span className={`shrink-0 text-sm font-medium tabular-nums ${amountColor}`}>{amountText}</span>
    </li>
  )
}

interface WhatsAppCreditHistoryProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WhatsAppCreditHistory({ open, onOpenChange }: WhatsAppCreditHistoryProps) {
  const isMobile = useIsMobile()
  const [periodId, setPeriodId] = useState<string | null>(null)
  const query = useWhatsAppCreditLedger(periodId, open)
  const pages = query.data?.pages
  const first = pages?.[0]
  const entries = useMemo(() => (pages ?? []).flatMap((p) => p.entries), [pages])
  const days = useMemo(() => groupByBrDay(entries), [entries])
  const selected = first?.periods.find((p) => p.id === first.periodId)
  const periodItems = Object.fromEntries((first?.periods ?? []).map((p) => [p.id, formatPeriod(p)]))
  const isEmpty = !!first && entries.length === 0

  const body = (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
      {first && (
        <div className="space-y-2">
          <Select items={periodItems} value={first.periodId} onValueChange={setPeriodId}>
            <SelectTrigger className="w-full" aria-label="Período">
              <SelectValue />
            </SelectTrigger>
            <SelectContent />
          </Select>
          {selected && <p className="text-xs text-mid">{usageLabel(selected)}</p>}
        </div>
      )}

      {query.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      )}

      {query.isError && <p className="text-sm text-red-700">Não foi possível carregar o histórico.</p>}

      {isEmpty && <p className="text-sm text-mid">Nenhum crédito usado neste período</p>}

      {days.map((day) => (
        <section key={day.ymd}>
          <h3 className="uppercase tracking-wider text-xs font-medium text-mid border-b border-topbar-border pb-1">
            {formatInTimeZone(parseBrDate(day.ymd), BR_TZ, 'dd/MM')}
          </h3>
          <ul className="divide-y divide-topbar-border">
            {day.entries.map((entry) => (
              <LedgerLine key={entry.id} entry={entry} />
            ))}
          </ul>
        </section>
      ))}

      {query.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
        >
          Carregar mais
        </Button>
      )}
    </div>
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="p-4 data-[side=bottom]:h-dvh">
          <SheetHeader className="p-0">
            <SheetTitle>Histórico de créditos</SheetTitle>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Histórico de créditos</DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  )
}
