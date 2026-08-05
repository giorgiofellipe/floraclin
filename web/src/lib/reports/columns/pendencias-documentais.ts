import { formatDate } from '@/lib/utils'
import { formatBrPhone } from '@/lib/phone'
import type { DocumentGapMissing, DocumentGapRow } from '@/db/queries/reports/pendencias-documentais'
import type { ReportColumn } from '../types'

const MISSING_LABELS: Record<DocumentGapMissing, string> = {
  anamnese: 'Anamnese',
  consentimento: 'Consentimento',
  both: 'Anamnese e consentimento',
}

/**
 * Column definitions for the "Pendências documentais" report. Rendered by
 * the on-screen table AND used to build the CSV/PDF exports (see
 * `web/src/app/api/reports/pendencias-documentais/route.ts`), so the screen
 * and the exported file can never disagree.
 *
 * `row.procedureDate` is a `YYYY-MM-DD` string (a BR calendar day, not an
 * instant) or `null` when the row's only gap is a missing anamnese.
 * `formatDate` already knows to parse a bare date string at local noon
 * rather than as UTC midnight, so it is safe to pass straight through.
 */
export const DOCUMENT_GAP_COLUMNS: ReportColumn<DocumentGapRow>[] = [
  {
    key: 'fullName',
    header: 'Paciente',
    value: (row) => row.fullName,
    sortable: true,
  },
  {
    key: 'phone',
    header: 'Telefone',
    value: (row) => formatBrPhone(row.phone),
  },
  {
    key: 'missing',
    header: 'Pendência',
    value: (row) => MISSING_LABELS[row.missing],
  },
  {
    key: 'procedureTypeName',
    header: 'Procedimento',
    value: (row) => row.procedureTypeName ?? '-',
  },
  {
    key: 'procedureDate',
    header: 'Data do procedimento',
    value: (row) => (row.procedureDate ? formatDate(row.procedureDate) : '-'),
    align: 'right',
    sortable: true,
  },
]
