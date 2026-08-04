'use client'

import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { getReport } from '@/lib/reports/registry'
import { ReportShell } from '@/components/reports/report-shell'
import type { ReportFilterValues } from '@/components/reports/report-filters'
import { ReportTable } from '@/components/reports/report-table'
import { LEDGER_REPORT_COLUMNS } from '@/lib/reports/columns/extrato-periodo'
import type { LedgerReportRow } from '@/db/queries/reports/extrato-periodo'
import type { ReportSort } from '@/lib/reports/types'

// The registry is the single source of truth for which reports exist, see
// web/src/lib/reports/registry.ts. This slug is guaranteed to be present.
const REPORT = getReport('extrato-periodo')!

/**
 * Fetches the report rows for the currently active date range and sort. An
 * absent `dateFrom`/`dateTo` (nothing picked yet) is sent through as-is: the
 * route falls back to the current BR calendar month to date, the same
 * "blank input -> omit param -> route default applies" pattern the
 * threshold-days reports use (see `useInactivePatientsReport`).
 */
function useLedgerReport(filters: ReportFilterValues, sort: ReportSort | undefined) {
  const dateFrom = filters.dateFrom?.trim()
  const dateTo = filters.dateTo?.trim()

  return useQuery({
    queryKey: ['reports', 'extrato-periodo', dateFrom || 'default', dateTo || 'default', sort?.key, sort?.dir],
    queryFn: async (): Promise<LedgerReportRow[]> => {
      const params = new URLSearchParams()
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      if (sort) {
        params.set('sort', sort.key)
        params.set('dir', sort.dir)
      }

      const res = await fetch(`/api/reports/extrato-periodo?${params.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar relatório')
      }
      const json = await res.json()
      return (json.data as (Omit<LedgerReportRow, 'movementDate'> & { movementDate: string })[]).map(
        (row) => ({ ...row, movementDate: new Date(row.movementDate) }),
      )
    },
  })
}

function ExtratoPeriodoBody({
  filters,
  sort,
  onSortChange,
}: {
  filters: ReportFilterValues
  sort: ReportSort | undefined
  onSortChange: (key: string) => void
}) {
  const { data, isLoading, isError } = useLedgerReport(filters, sort)

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
    <ReportTable rows={data ?? []} columns={LEDGER_REPORT_COLUMNS} sort={sort} onSortChange={onSortChange} />
  )
}

export default function ExtratoPeriodoPage() {
  return (
    <ReportShell
      title={REPORT.title}
      description={REPORT.description}
      filters={REPORT.filters}
      apiPath={REPORT.apiPath}
    >
      {(filters, sort, onSortChange) => (
        <ExtratoPeriodoBody filters={filters} sort={sort} onSortChange={onSortChange} />
      )}
    </ReportShell>
  )
}
