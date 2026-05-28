'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Cake, Search, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { brToday } from '@/lib/dates'
import { useBirthdays, type BirthdayItem } from '@/hooks/queries/use-birthdays'
import { BirthdayRowActions } from '@/components/patients/birthday-row-actions'

const MONTHS: Array<{ value: string; label: string }> = [
  { value: '1', label: 'Janeiro' },
  { value: '2', label: 'Fevereiro' },
  { value: '3', label: 'Março' },
  { value: '4', label: 'Abril' },
  { value: '5', label: 'Maio' },
  { value: '6', label: 'Junho' },
  { value: '7', label: 'Julho' },
  { value: '8', label: 'Agosto' },
  { value: '9', label: 'Setembro' },
  { value: '10', label: 'Outubro' },
  { value: '11', label: 'Novembro' },
  { value: '12', label: 'Dezembro' },
]

const MONTH_ITEMS: Record<string, string> = MONTHS.reduce<Record<string, string>>(
  (acc, m) => {
    acc[m.value] = m.label
    return acc
  },
  {}
)

/** Number of days in a given month for a given year. Handles leap years. */
function daysInMonth(year: number, month1based: number): number {
  // month is 1-based here; Date with day=0 gives the last day of the previous month
  return new Date(year, month1based, 0).getDate()
}

/** Format `MM-DD` from a YYYY-MM-DD string to "DD/MM" for display. */
function formatDayMonth(birthDate: string): string {
  const [, mm, dd] = birthDate.split('-')
  return `${dd}/${mm}`
}

/**
 * Aniversariantes page client. Defaults to current BR month and filters by name.
 * Filtering is local to the fetched month — search field is fast for typical
 * tenant sizes; if a tenant ever needs server-side search, swap the filter into
 * a query param.
 */
export function AniversariantesPageClient() {
  const today = brToday()
  const currentYear = parseInt(today.slice(0, 4), 10)
  const currentMonth = parseInt(today.slice(5, 7), 10)

  const [selectedMonth, setSelectedMonth] = useState<string>(String(currentMonth))
  const [search, setSearch] = useState('')

  const { from, to } = useMemo(() => {
    const monthInt = parseInt(selectedMonth, 10)
    const lastDay = daysInMonth(currentYear, monthInt)
    const mm = String(monthInt).padStart(2, '0')
    return {
      from: `${currentYear}-${mm}-01`,
      to: `${currentYear}-${mm}-${String(lastDay).padStart(2, '0')}`,
    }
  }, [selectedMonth, currentYear])

  const { data, isLoading, isError } = useBirthdays({ from, to })

  const filtered = useMemo<BirthdayItem[]>(() => {
    const items: BirthdayItem[] = data ?? []
    const q = search.trim().toLowerCase()
    const sorted = [...items].sort((a, b) => {
      // sort by month-day ascending
      const aKey = a.birthDate.slice(5)
      const bKey = b.birthDate.slice(5)
      if (aKey !== bKey) return aKey.localeCompare(bKey)
      return a.fullName.localeCompare(b.fullName, 'pt-BR')
    })
    if (!q) return sorted
    return sorted.filter((r) => r.fullName.toLowerCase().includes(q))
  }, [data, search])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-[24px] font-medium text-[#2A2A2A]">
            <Cake className="size-5 text-blush" />
            Aniversariantes
          </h1>
          <p className="mt-1 text-[13px] text-[#7A7A7A]">
            Pacientes com aniversário no mês selecionado.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <label className="text-[13px] text-mid" htmlFor="aniv-month">
            Mês
          </label>
          <Select
            items={MONTH_ITEMS}
            value={selectedMonth}
            onValueChange={(v) => setSelectedMonth(v ?? String(currentMonth))}
          >
            <SelectTrigger id="aniv-month" className="min-w-[160px]">
              <SelectValue placeholder="Selecione o mês" />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>

        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mid" />
          <Input
            type="search"
            placeholder="Buscar por nome..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="aniversariantes-search"
          />
        </div>
      </div>

      {/* Body */}
      <div className="bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px]">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-5 animate-spin text-mid" />
          </div>
        ) : isError ? (
          <div className="py-12 text-center text-[13px] text-mid">
            Não foi possível carregar aniversariantes.
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-[14px] font-medium text-[#2A2A2A]">
              Nenhum aniversariante encontrado
            </p>
            <p className="mt-1 text-[13px] text-[#7A7A7A]">
              {search
                ? 'Tente outro termo de busca.'
                : 'Ninguém faz aniversário nesse mês.'}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">Data</TableHead>
                <TableHead className="px-4">Paciente</TableHead>
                <TableHead className="px-4">Idade</TableHead>
                <TableHead className="px-4">Status</TableHead>
                <TableHead className="px-4 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="px-4 font-medium text-[#2A2A2A]">
                    {formatDayMonth(item.birthDate)}
                  </TableCell>
                  <TableCell className="px-4">
                    <Link
                      href={`/pacientes/${item.id}`}
                      className="text-[#2A2A2A] hover:underline"
                    >
                      {item.fullName}
                    </Link>
                  </TableCell>
                  <TableCell className="px-4 text-mid">
                    {item.ageTurning} ano{item.ageTurning !== 1 ? 's' : ''}
                  </TableCell>
                  <TableCell className="px-4">
                    {item.greetedAt ? (
                      <span className="inline-flex items-center rounded-full bg-sage/10 px-2 py-0.5 text-[12px] font-medium text-sage">
                        Parabenizado
                        {item.greetedByName ? ` · ${item.greetedByName}` : ''}
                      </span>
                    ) : (
                      <span className="text-[12px] text-mid">—</span>
                    )}
                  </TableCell>
                  <TableCell className="px-4">
                    <div className="flex justify-end">
                      <BirthdayRowActions
                        patientId={item.id}
                        patientPhone={item.phone}
                        greetedAt={item.greetedAt}
                        year={currentYear}
                        size="default"
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
