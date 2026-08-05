import { formatCurrency } from '@/lib/utils'
import type { PractitionerPLRow } from '@/db/queries/reports/ganhos-profissional'
import type { ReportColumn } from '../types'

/**
 * Column definitions for the "Ganhos por profissional" report. Backed by
 * `getPractitionerPL` (see `web/src/db/queries/reports/ganhos-profissional.ts`
 * for why "gross"/"net" map onto `revenueGenerated`/`revenueCollected`
 * rather than a commission figure, which doesn't exist anywhere in this
 * codebase).
 */
export const PRACTITIONER_EARNINGS_COLUMNS: ReportColumn<PractitionerPLRow>[] = [
  {
    key: 'practitionerName',
    header: 'Profissional',
    value: (row) => row.practitionerName,
    sortable: true,
  },
  {
    key: 'procedureCount',
    header: 'Procedimentos',
    value: (row) => String(row.procedureCount),
    align: 'right',
    sortable: true,
  },
  {
    key: 'revenueGenerated',
    header: 'Receita bruta',
    value: (row) => formatCurrency(row.revenueGenerated),
    align: 'right',
    sortable: true,
  },
  {
    key: 'revenueCollected',
    header: 'Receita líquida',
    value: (row) => formatCurrency(row.revenueCollected),
    align: 'right',
    sortable: true,
  },
]
