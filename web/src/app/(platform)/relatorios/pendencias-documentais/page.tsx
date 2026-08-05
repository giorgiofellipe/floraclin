'use client'

import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { getReport } from '@/lib/reports/registry'
import { ReportShell } from '@/components/reports/report-shell'
import { ReportTable } from '@/components/reports/report-table'
import { ReportWhatsAppAction } from '@/components/reports/report-whatsapp-action'
import { DOCUMENT_GAP_COLUMNS } from '@/lib/reports/columns/pendencias-documentais'
import type { DocumentGapRow } from '@/db/queries/reports/pendencias-documentais'
import type { ReportSort } from '@/lib/reports/types'

// The registry is the single source of truth for which reports exist, see
// web/src/lib/reports/registry.ts. This slug is guaranteed to be present.
const REPORT = getReport('pendencias-documentais')!

/**
 * Fetches the report rows for the currently active sort. This report
 * declares no filters (see the registry entry): it's a compliance snapshot,
 * not a time-windowed list, so the only thing carried into the request and
 * the export URL besides the format is the active sort.
 */
function useDocumentGapsReport(sort: ReportSort | undefined) {
  return useQuery({
    queryKey: ['reports', 'pendencias-documentais', sort?.key, sort?.dir],
    queryFn: async (): Promise<DocumentGapRow[]> => {
      const params = new URLSearchParams()
      if (sort) {
        params.set('sort', sort.key)
        params.set('dir', sort.dir)
      }

      const res = await fetch(`/api/reports/pendencias-documentais?${params.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar relatório')
      }
      const json = await res.json()
      return json.data as DocumentGapRow[]
    },
  })
}

function PendenciasDocumentaisBody({
  sort,
  onSortChange,
}: {
  sort: ReportSort | undefined
  onSortChange: (key: string) => void
}) {
  const { data, isLoading, isError } = useDocumentGapsReport(sort)

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
      columns={DOCUMENT_GAP_COLUMNS}
      // The anamnese-link and consent signing-link senders both require
      // roles this report's own guard doesn't grant (financial can open the
      // report but neither endpoint accepts that role), and the signing
      // link additionally needs a client-computed set of required consent
      // types with no server-side equivalent to reuse from a table row (see
      // implementation notes). Falls back to the same generic WhatsApp
      // action every other report row uses instead of a broken send button.
      rowAction={(row) => <ReportWhatsAppAction phone={row.phone} fullName={row.fullName} />}
      sort={sort}
      onSortChange={onSortChange}
      emptyHint={REPORT.emptyHint}
    />
  )
}

export default function PendenciasDocumentaisPage() {
  return (
    <ReportShell
      title={REPORT.title}
      description={REPORT.description}
      filters={REPORT.filters}
      apiPath={REPORT.apiPath}
    >
      {(_filters, sort, onSortChange) => (
        <PendenciasDocumentaisBody sort={sort} onSortChange={onSortChange} />
      )}
    </ReportShell>
  )
}
