'use client'

import { useMemo } from 'react'
import type { ReportFilterKind } from '@/lib/reports/types'
import { usePractitioners } from '@/hooks/queries/use-appointments'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DateRangePicker } from '@/components/ui/date-picker'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

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
}

interface ReportFiltersProps {
  filters: ReportFilterKind[]
  value: ReportFilterValues
  onChange: (value: ReportFilterValues) => void
}

export function ReportFilters({ filters, value, onChange }: ReportFiltersProps) {
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

  if (filters.length === 0) return null

  return (
    <div className="flex flex-wrap items-end gap-3">
      {filters.includes('threshold-days') && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="report-threshold-days" className="text-xs text-mid">
            Limite (dias)
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
    </div>
  )
}
