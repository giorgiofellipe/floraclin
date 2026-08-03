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

// The registry is the single source of truth for which reports exist, see
// web/src/lib/reports/registry.ts. This slug is guaranteed to be present.
const REPORT = getReport('pacientes-inativos')!

/**
 * Fetches the report rows for the currently active filters. `thresholdDays`
 * is the only filter this report declares; an absent/blank value lets the
 * route fall back to `tenants.settings.inactive_threshold_days` (or 180).
 */
function useInactivePatientsReport(filters: ReportFilterValues) {
  const thresholdDays = filters.thresholdDays?.trim()

  return useQuery({
    queryKey: ['reports', 'pacientes-inativos', thresholdDays || 'default'],
    queryFn: async (): Promise<InactivePatientRow[]> => {
      const params = new URLSearchParams()
      if (thresholdDays) params.set('thresholdDays', thresholdDays)

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

function PacientesInativosBody({ filters }: { filters: ReportFilterValues }) {
  const { data, isLoading, isError } = useInactivePatientsReport(filters)

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
    />
  )
}

export default function PacientesInativosPage() {
  return (
    <ReportShell title={REPORT.title} description={REPORT.description} filters={REPORT.filters}>
      {(filters) => <PacientesInativosBody filters={filters} />}
    </ReportShell>
  )
}
