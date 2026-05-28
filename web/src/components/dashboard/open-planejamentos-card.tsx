'use client'

import Link from 'next/link'
import { differenceInDays } from 'date-fns'
import { ArrowRight, ClipboardList, MessageCircle } from 'lucide-react'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { brToday, parseBrDate } from '@/lib/dates'
import { formatCurrency } from '@/lib/utils'
import { useOpenPlanejamentos, type OpenPlanejamento } from '@/hooks/queries/use-planejamentos'

function buildWhatsappHref(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '')
  if (!digits) return '/whatsapp'
  return `/whatsapp?phone=${digits}`
}

function staleDays(row: OpenPlanejamento): number {
  const reference = row.lastContactedAt ?? row.createdAt
  const today = parseBrDate(brToday(), '12:00:00')
  return Math.max(0, differenceInDays(today, new Date(reference)))
}

export function OpenPlanejamentosCard() {
  const { data, isLoading } = useOpenPlanejamentos({ limit: 5 })
  const rows = data?.data ?? []

  return (
    <Card className="border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)] bg-white rounded-[3px]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-sage" />
            <span className="text-xs font-medium uppercase tracking-wider text-mid">
              Planejamentos abertos
            </span>
          </div>
          <Link
            href="/crm/planejamentos"
            className="inline-flex items-center gap-1 text-xs text-mid transition-colors hover:text-forest"
          >
            Ver todos
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-petal">
              <ClipboardList className="h-6 w-6 text-sage" />
            </div>
            <p className="font-medium text-charcoal">Tudo em dia!</p>
            <p className="mt-1 text-sm text-mid">
              Nenhum planejamento aberto sem contato.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const days = staleDays(row)
              const daysLabel =
                days === 0 ? 'Hoje' : days === 1 ? '1d' : `${days}d`
              const badgeColor =
                days >= 14
                  ? 'bg-destructive/10 text-destructive'
                  : days >= 7
                    ? 'bg-amber-light text-amber-dark'
                    : 'bg-sage/10 text-sage'

              return (
                <li key={row.id}>
                  <div className="group flex items-start justify-between gap-3 rounded-lg border border-transparent p-3 transition-all duration-200 hover:border-sage/15 hover:bg-petal/30 hover:shadow-sm">
                    <Link
                      href={`/pacientes/${row.patientId}/procedimentos/${row.id}`}
                      className="min-w-0 flex-1"
                    >
                      <p className="truncate font-medium text-charcoal">
                        {row.patientName}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-mid">
                        {row.procedureTypeName}
                      </p>
                    </Link>
                    <div className="flex shrink-0 items-center gap-2">
                      {row.totalAmount && (
                        <span className="hidden text-xs tabular-nums text-mid sm:inline">
                          {formatCurrency(Number(row.totalAmount))}
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${badgeColor}`}
                      >
                        {daysLabel}
                      </span>
                      <a
                        href={buildWhatsappHref(row.patientPhone)}
                        aria-label={`Enviar WhatsApp para ${row.patientName}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-mid hover:bg-sage/10 hover:text-sage"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
