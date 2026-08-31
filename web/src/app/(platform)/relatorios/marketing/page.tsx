'use client'

import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { getReport } from '@/lib/reports/registry'
import { ReportShell } from '@/components/reports/report-shell'
import type { ReportFilterValues } from '@/components/reports/report-filters'
import { ReportTable } from '@/components/reports/report-table'
import { MARKETING_REPORT_COLUMNS } from '@/lib/reports/columns/marketing'
import type { MarketingReportRow } from '@/db/queries/reports/marketing'
import type { ReportSort } from '@/lib/reports/types'

// The registry is the single source of truth for which reports exist, see
// web/src/lib/reports/registry.ts. This slug is guaranteed to be present.
const REPORT = getReport('marketing')!

/**
 * Fetches the report rows for the currently active date range and sort. Both
 * date inputs start seeded with the registry's default window (see
 * `ReportShell` and `ReportDefinition.defaultRangeDays`), so the usual case
 * sends an explicit range. If the user clears an input, the blank value is
 * omitted and the route completes the range itself (see `resolveDateRange`).
 */
function useMarketingReport(filters: ReportFilterValues, sort: ReportSort | undefined) {
  const dateFrom = filters.dateFrom?.trim()
  const dateTo = filters.dateTo?.trim()

  return useQuery({
    queryKey: ['reports', 'marketing', dateFrom || 'default', dateTo || 'default', sort?.key, sort?.dir],
    queryFn: async (): Promise<MarketingReportRow[]> => {
      const params = new URLSearchParams()
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      if (sort) {
        params.set('sort', sort.key)
        params.set('dir', sort.dir)
      }

      const res = await fetch(`/api/reports/marketing?${params.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar relatório')
      }
      const json = await res.json()
      return json.data as MarketingReportRow[]
    },
  })
}

function MarketingReportBody({
  filters,
  sort,
  onSortChange,
}: {
  filters: ReportFilterValues
  sort: ReportSort | undefined
  onSortChange: (key: string) => void
}) {
  const { data, isLoading, isError } = useMarketingReport(filters, sort)

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
      columns={MARKETING_REPORT_COLUMNS}
      sort={sort}
      onSortChange={onSortChange}
      emptyHint={REPORT.emptyHint}
    />
  )
}

export default function MarketingReportPage() {
  return (
    <ReportShell
      title={REPORT.title}
      description={REPORT.description}
      filters={REPORT.filters}
      apiPath={REPORT.apiPath}
      defaultRangeDays={REPORT.defaultRangeDays}
    >
      {(filters, sort, onSortChange) => (
        <MarketingReportBody filters={filters} sort={sort} onSortChange={onSortChange} />
      )}
    </ReportShell>
  )
}
