'use client'

import { useState, useMemo } from 'react'
import { usePractitionerPL } from '@/hooks/queries/use-practitioner-pl'
import { usePractitioners } from '@/hooks/queries/use-appointments'
import { DateRangePicker } from '@/components/ui/date-picker'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PractitionerCard } from './practitioner-card'
import { startOfMonth, format } from 'date-fns'

export function PractitionerPLView() {
  const now = useMemo(() => new Date(), [])
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(now), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(now, 'yyyy-MM-dd'))
  const [practitionerId, setPractitionerId] = useState('')

  const { data: practitioners } = usePractitioners()

  const practitionerItems = useMemo(() => {
    const items: Record<string, string> = { all: 'Todos os profissionais' }
    if (practitioners) {
      for (const p of practitioners as { id: string; fullName: string }[]) {
        items[p.id] = p.fullName
      }
    }
    return items
  }, [practitioners])

  const { data: plData, isPending } = usePractitionerPL(
    dateFrom,
    dateTo,
    practitionerId || undefined
  )

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={(v) => setDateFrom(v)}
          onDateToChange={(v) => setDateTo(v)}
        />

        <Select items={practitionerItems} value={practitionerId || 'all'} onValueChange={(v) => setPractitionerId(!v || v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[200px] border-sage/20">
            <SelectValue placeholder="Profissional" />
          </SelectTrigger>
          <SelectContent />
        </Select>
      </div>

      {/* Practitioner cards */}
      {isPending ? (
        <div className="flex items-center justify-center gap-2 py-16">
          <span className="size-2 animate-pulse rounded-full bg-sage" />
          <span className="text-sm text-mid">Carregando dados por profissional...</span>
        </div>
      ) : !plData || plData.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-mid text-sm">Nenhum dado de profissional encontrado no período.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
          {plData.map((pl) => (
            <PractitionerCard key={pl.practitionerId} data={pl} />
          ))}
        </div>
      )}
    </div>
  )
}
