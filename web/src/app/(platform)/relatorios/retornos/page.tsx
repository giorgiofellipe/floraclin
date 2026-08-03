'use client'

import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { getReport } from '@/lib/reports/registry'
import { ReportShell } from '@/components/reports/report-shell'
import type { ReportFilterValues } from '@/components/reports/report-filters'
import { ReportTable } from '@/components/reports/report-table'
import { ReportWhatsAppAction } from '@/components/reports/report-whatsapp-action'
import { DUE_FOLLOWUP_COLUMNS } from '@/lib/reports/columns/due-followups'
import type { DueFollowUpRow } from '@/db/queries/reports/due-followups'

// The registry is the single source of truth for which reports exist, see
// web/src/lib/reports/registry.ts. This slug is guaranteed to be present.
const REPORT = getReport('retornos')!

/**
 * Fetches the report rows for the currently active filters. The report
 * declares a `threshold-days` filter (the same numeric input pacientes
 * inativos uses), but here it represents the recall window in days rather
 * than an inactivity threshold; an absent/blank value lets the route fall
 * back to its own 30-day default.
 */
function useDueFollowUpsReport(filters: ReportFilterValues) {
  const windowDays = filters.thresholdDays?.trim()

  return useQuery({
    queryKey: ['reports', 'retornos', windowDays || 'default'],
    queryFn: async (): Promise<DueFollowUpRow[]> => {
      const params = new URLSearchParams()
      if (windowDays) params.set('windowDays', windowDays)

      const res = await fetch(`/api/reports/due-followups?${params.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar relatório')
      }
      const json = await res.json()
      return json.data as DueFollowUpRow[]
    },
  })
}

function RetornosBody({ filters }: { filters: ReportFilterValues }) {
  const { data, isLoading, isError } = useDueFollowUpsReport(filters)

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
      columns={DUE_FOLLOWUP_COLUMNS}
      rowAction={(row) => <ReportWhatsAppAction phone={row.phone} fullName={row.fullName} />}
      // Overdue follow-ups get a red tint so they stand out from rows that
      // are merely coming up soon: the "Vencido há N dias" text already says
      // it, but a row that needs to be called back-dated deserves to be seen
      // at a glance, not just read.
      rowClassName={(row) => (row.isOverdue ? 'bg-[#FBEAEA]' : undefined)}
    />
  )
}

export default function RetornosPage() {
  return (
    <ReportShell
      title={REPORT.title}
      description={REPORT.description}
      filters={REPORT.filters}
      apiPath={REPORT.apiPath}
      paramName={REPORT.paramName}
      defaultDays={REPORT.defaultDays}
    >
      {(filters) => <RetornosBody filters={filters} />}
    </ReportShell>
  )
}
