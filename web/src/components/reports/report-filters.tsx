'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import type { ReportFilterKind } from '@/lib/reports/types'
import { usePractitioners } from '@/hooks/queries/use-appointments'
import { usePatientSearch } from '@/hooks/queries/use-patients'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DateRangePicker } from '@/components/ui/date-picker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** How long to wait after the last keystroke before searching, so typing a
 *  full name doesn't fire a request per character. Matches the debounce the
 *  appointment form's inline patient search already uses (see
 *  `appointment-form.tsx`). */
const PATIENT_SEARCH_DEBOUNCE_MS = 300

/**
 * Current values for every filter kind a report may declare. Keys stay
 * optional and independent of which `ReportFilterKind`s are actually shown,
 * so the same shape can be preserved verbatim in the export query string.
 */
export interface ReportFilterValues {
  thresholdDays?: string
  dateFrom?: string
  dateTo?: string
  practitionerId?: string
  minCount?: string
  patientId?: string
}

interface ReportFiltersProps {
  filters: ReportFilterKind[]
  value: ReportFilterValues
  onChange: (value: ReportFilterValues) => void
  /** Label for the day-count (`threshold-days`) input. The same filter kind
   *  means a different thing per report, so the copy is supplied by the
   *  caller (ultimately the report's registry entry) rather than hardcoded
   *  here. Only relevant when `filters` includes `'threshold-days'`. */
  dayFilterLabel?: string
}

export function ReportFilters({ filters, value, onChange, dayFilterLabel }: ReportFiltersProps) {
  // Only fetch practitioners when the report actually declares the
  // `practitioner` filter kind. Reports without it (the two recall reports
  // that don't filter by practitioner, and any future report that skips it)
  // must not fire this request on every render.
  const { data: practitioners } = usePractitioners({ enabled: filters.includes('practitioner') })

  const practitionerItems = useMemo(() => {
    const items: Record<string, string> = { all: 'Todos os profissionais' }
    if (practitioners) {
      for (const p of practitioners as { id: string; fullName: string }[]) {
        items[p.id] = p.fullName
      }
    }
    return items
  }, [practitioners])

  if (filters.length === 0) return null

  return (
    <div className="flex flex-wrap items-end gap-3">
      {filters.includes('threshold-days') && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="report-threshold-days" className="text-xs text-mid">
            {dayFilterLabel}
          </Label>
          <Input
            id="report-threshold-days"
            type="number"
            min={0}
            inputMode="numeric"
            className="w-[100px]"
            value={value.thresholdDays ?? ''}
            onChange={(e) => onChange({ ...value, thresholdDays: e.target.value })}
          />
        </div>
      )}

      {filters.includes('min-count') && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="report-min-count" className="text-xs text-mid">
            Mínimo de faltas
          </Label>
          <Input
            id="report-min-count"
            type="number"
            min={1}
            inputMode="numeric"
            className="w-[100px]"
            value={value.minCount ?? ''}
            onChange={(e) => onChange({ ...value, minCount: e.target.value })}
          />
        </div>
      )}

      {filters.includes('date-range') && (
        <DateRangePicker
          dateFrom={value.dateFrom}
          dateTo={value.dateTo}
          onDateFromChange={(v) => onChange({ ...value, dateFrom: v })}
          onDateToChange={(v) => onChange({ ...value, dateTo: v })}
        />
      )}

      {filters.includes('practitioner') && (
        <Select
          items={practitionerItems}
          value={value.practitionerId || 'all'}
          onValueChange={(v) =>
            onChange({ ...value, practitionerId: !v || v === 'all' ? undefined : v })
          }
        >
          <SelectTrigger className="w-[200px] border-sage/20">
            <SelectValue placeholder="Profissional" />
          </SelectTrigger>
          <SelectContent />
        </Select>
      )}

      {filters.includes('patient') && (
        <PatientFilter
          value={value.patientId}
          onChange={(patientId) => onChange({ ...value, patientId })}
        />
      )}
    </div>
  )
}

/**
 * SUGGEST-style patient filter: type to search, pick one from the matches.
 * Not a `<select>` with every patient in it, on purpose. Even the demo
 * tenant alone has 50 patients, and a real clinic has thousands, so a plain
 * dropdown would be unusable (see `usePatientSearch`).
 *
 * `ReportFilterValues` only carries `patientId` (the value that has to
 * survive into the export URL), so the matching display name is kept as
 * local UI state here rather than lifted with it, mirroring how the
 * practitioner `Select` derives its label from a separately-fetched list.
 */
function PatientFilter({
  value,
  onChange,
}: {
  value: string | undefined
  onChange: (patientId: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedName, setSelectedName] = useState<string | undefined>(undefined)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), PATIENT_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [search])

  // Autofocus only: an imperative DOM call, not a setState, so it stays a
  // plain effect. Clearing the search text on close lives in
  // `handleOpenChange` below instead of a second effect keyed off `open`,
  // since setting state directly inside an effect body (rather than from an
  // event handler) is exactly the cascading-render pattern React warns
  // against.
  useEffect(() => {
    if (!open) return undefined
    const id = window.setTimeout(() => searchInputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  const { data: results, isFetching } = usePatientSearch(debouncedSearch)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) setSearch('')
  }

  function handleSelect(patient: { id: string; fullName: string }) {
    setSelectedName(patient.fullName)
    onChange(patient.id)
    setOpen(false)
  }

  function handleClear() {
    setSelectedName(undefined)
    onChange(undefined)
    setOpen(false)
  }

  const trimmedSearch = search.trim()

  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-mid">Paciente</Label>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={
            <button
              type="button"
              data-testid="report-patient-filter-trigger"
              className={cn(
                'flex w-[220px] items-center justify-between gap-2 rounded-lg border border-sage/20 bg-white px-3 py-2 text-left text-sm transition-colors',
                'hover:border-sage/40 focus:outline-none focus:ring-2 focus:ring-sage/30',
              )}
            />
          }
        >
          <span className={cn('truncate', value && selectedName ? 'text-charcoal' : 'text-mid/60')}>
            {value && selectedName ? selectedName : 'Todos os pacientes'}
          </span>
          <ChevronDown className="size-4 shrink-0 text-mid" />
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={4} className="w-[280px] p-0">
          <div className="flex items-center gap-2 border-b border-[#E8ECEF] px-3 py-2">
            <Search className="size-4 shrink-0 text-mid" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar paciente..."
              className="h-7 border-0 px-0 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              data-testid="report-patient-filter-search"
            />
          </div>
          <div className="max-h-[280px] overflow-y-auto py-1" data-testid="report-patient-filter-list">
            {value && (
              <button
                type="button"
                onClick={handleClear}
                data-testid="report-patient-filter-clear"
                className="flex w-full items-center px-3 py-2 text-left text-sm text-mid transition-colors hover:bg-[#F4F6F8]"
              >
                Todos os pacientes
              </button>
            )}
            {trimmedSearch.length < 2 ? (
              <div className="px-3 py-6 text-center text-xs text-mid">
                Digite ao menos 2 letras para buscar
              </div>
            ) : isFetching ? (
              <div className="px-3 py-6 text-center text-xs text-mid">Buscando...</div>
            ) : !results || results.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-mid">Nenhum paciente encontrado</div>
            ) : (
              results.map((patient) => {
                const isSelected = patient.id === value
                return (
                  <button
                    key={patient.id}
                    type="button"
                    onClick={() => handleSelect(patient)}
                    data-testid={`report-patient-filter-option-${patient.id}`}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                      isSelected ? 'bg-sage/10 text-forest' : 'text-charcoal hover:bg-[#F4F6F8]',
                    )}
                  >
                    <span className="flex-1 truncate">{patient.fullName}</span>
                    {isSelected && <Check className="size-4 shrink-0 text-forest" />}
                  </button>
                )
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
