'use client'

import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { getReport } from '@/lib/reports/registry'
import { ReportShell } from '@/components/reports/report-shell'
import type { ReportFilterValues } from '@/components/reports/report-filters'
import { ReportTable } from '@/components/reports/report-table'
import { ReportWhatsAppAction } from '@/components/reports/report-whatsapp-action'
import { REPEAT_NO_SHOW_COLUMNS } from '@/lib/reports/columns/repeat-no-shows'
import type { RepeatNoShowRow } from '@/db/queries/reports/repeat-no-shows'
import type { ReportSort } from '@/lib/reports/types'

// The registry is the single source of truth for which reports exist, see
// web/src/lib/reports/registry.ts. This slug is guaranteed to be present.
const REPORT = getReport('faltas')!

/**
 * Fetches the report rows for the currently active filters and sort. The
 * report declares a `threshold-days` filter representing the lookback window
 * in days, and a `min-count` filter for the minimum number of misses; an
 * absent/blank value for either lets the route fall back to its own default
 * (see `web/src/app/api/reports/repeat-no-shows/route.ts`). Sort is included
 * in both the query key and the request so the fetch always matches the
 * export URL (see `ReportShell`, which owns both).
 */
function useRepeatNoShowsReport(filters: ReportFilterValues, sort: ReportSort | undefined) {
  const windowDays = filters.thresholdDays?.trim()
  const minCount = filters.minCount?.trim()

  return useQuery({
    queryKey: [
      'reports',
      'faltas',
      windowDays || 'default',
      minCount || 'default',
      sort?.key,
      sort?.dir,
    ],
    queryFn: async (): Promise<RepeatNoShowRow[]> => {
      const params = new URLSearchParams()
      if (windowDays) params.set('windowDays', windowDays)
      if (minCount) params.set('minCount', minCount)
      if (sort) {
        params.set('sort', sort.key)
        params.set('dir', sort.dir)
      }

      const res = await fetch(`/api/reports/repeat-no-shows?${params.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar relatório')
      }
      const json = await res.json()
      return json.data as RepeatNoShowRow[]
    },
  })
}

function FaltasBody({
  filters,
  sort,
  onSortChange,
}: {
  filters: ReportFilterValues
  sort: ReportSort | undefined
  onSortChange: (key: string) => void
}) {
  const { data, isLoading, isError } = useRepeatNoShowsReport(filters, sort)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-mid" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-[3px] bg-white py-12 text-center text-[13px] text-mid shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        Não foi possível carregar o relatório.
      </div>
    )
  }

  return (
    <ReportTable
      rows={data ?? []}
      columns={REPEAT_NO_SHOW_COLUMNS}
      rowAction={(row) => <ReportWhatsAppAction phone={row.phone} fullName={row.fullName} />}
      sort={sort}
      onSortChange={onSortChange}
      emptyHint={REPORT.emptyHint}
    />
  )
}

export default function FaltasPage() {
  return (
    <ReportShell
      title={REPORT.title}
      description={REPORT.description}
      filters={REPORT.filters}
      apiPath={REPORT.apiPath}
      paramName={REPORT.paramName}
      defaultDays={REPORT.defaultDays}
      filterLabel={REPORT.filterLabel}
      defaultMinCount={REPORT.defaultMinCount}
    >
      {(filters, sort, onSortChange) => (
        <FaltasBody filters={filters} sort={sort} onSortChange={onSortChange} />
      )}
    </ReportShell>
  )
}
