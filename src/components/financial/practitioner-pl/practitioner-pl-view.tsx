'use client'

import { useState, useMemo } from 'react'
import { usePractitionerPL } from '@/hooks/queries/use-practitioner-pl'
import { usePractitioners } from '@/hooks/queries/use-appointments'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
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
  const { data: plData, isPending } = usePractitionerPL(
    dateFrom,
    dateTo,
    practitionerId || undefined
  )

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-[150px] border-sage/20"
          />
          <span className="text-mid text-sm">ate</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-[150px] border-sage/20"
          />
        </div>

        <Select value={practitionerId || 'all'} onValueChange={(v) => setPractitionerId(!v || v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[200px] border-sage/20">
            <SelectValue placeholder="Profissional">
              {(value: string) => {
                if (value === 'all') return 'Todos os profissionais'
                const p = (practitioners as { id: string; name: string }[] | undefined)?.find((pr: { id: string }) => pr.id === value)
                return p?.name ?? value
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os profissionais</SelectItem>
            {(practitioners as { id: string; name: string }[] | undefined)?.map((p: { id: string; name: string }) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
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
          <p className="text-mid text-sm">Nenhum dado de profissional encontrado no periodo.</p>
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
