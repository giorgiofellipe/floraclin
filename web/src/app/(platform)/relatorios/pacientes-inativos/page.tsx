'use client'

import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { getReport } from '@/lib/reports/registry'
import { ReportShell } from '@/components/reports/report-shell'
import type { ReportFilterValues } from '@/components/reports/report-filters'
import { ReportTable } from '@/components/reports/report-table'
import { ReportWhatsAppAction } from '@/components/reports/report-whatsapp-action'
import { INACTIVE_PATIENT_COLUMNS } from '@/lib/reports/columns/inactive-patients'
import type { InactivePatientRow } from '@/db/queries/reports/inactive-patients'
import type { ReportSort } from '@/lib/reports/types'

// The registry is the single source of truth for which reports exist, see
// web/src/lib/reports/registry.ts. This slug is guaranteed to be present.
const REPORT = getReport('pacientes-inativos')!

/**
 * Fetches the report rows for the currently active filters and sort.
 * `thresholdDays` is the only filter this report declares; the filter starts
 * pre-filled with the registry default (see `ReportShell`), and if the user
 * clears it, the blank value is omitted from the query so the route falls
 * back to that same registry default (`getReport('pacientes-inativos').defaultDays`,
 * 180). Sort is included in both the query key and the request so the fetch
 * always matches the export URL (see `ReportShell`, which owns both).
 */
function useInactivePatientsReport(filters: ReportFilterValues, sort: ReportSort | undefined) {
  const thresholdDays = filters.thresholdDays?.trim()

  return useQuery({
    queryKey: ['reports', 'pacientes-inativos', thresholdDays || 'default', sort?.key, sort?.dir],
    queryFn: async (): Promise<InactivePatientRow[]> => {
      const params = new URLSearchParams()
      if (thresholdDays) params.set('thresholdDays', thresholdDays)
      if (sort) {
        params.set('sort', sort.key)
        params.set('dir', sort.dir)
      }

      const res = await fetch(`/api/reports/inactive-patients?${params.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar relatório')
      }
      const json = await res.json()
      return json.data as InactivePatientRow[]
    },
  })
}

function PacientesInativosBody({
  filters,
  sort,
  onSortChange,
}: {
  filters: ReportFilterValues
  sort: ReportSort | undefined
  onSortChange: (key: string) => void
}) {
  const { data, isLoading, isError } = useInactivePatientsReport(filters, sort)

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
      columns={INACTIVE_PATIENT_COLUMNS}
      rowAction={(row) => <ReportWhatsAppAction phone={row.phone} fullName={row.fullName} />}
      sort={sort}
      onSortChange={onSortChange}
      emptyHint={REPORT.emptyHint}
    />
  )
}

export default function PacientesInativosPage() {
  return (
    <ReportShell
      title={REPORT.title}
      description={REPORT.description}
      filters={REPORT.filters}
      apiPath={REPORT.apiPath}
      paramName={REPORT.paramName}
      defaultDays={REPORT.defaultDays}
      filterLabel={REPORT.filterLabel}
    >
      {(filters, sort, onSortChange) => (
        <PacientesInativosBody filters={filters} sort={sort} onSortChange={onSortChange} />
      )}
    </ReportShell>
  )
}
