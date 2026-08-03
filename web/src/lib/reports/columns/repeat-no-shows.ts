import { formatCurrency, formatDate } from '@/lib/utils'
import { formatBrPhone } from '@/lib/phone'
import type { RepeatNoShowRow } from '@/db/queries/reports/repeat-no-shows'
import type { ReportColumn } from '../types'

/**
 * Column definitions for the "Faltas recorrentes" report. Rendered by the
 * on-screen table AND used to build the CSV/PDF exports (see
 * `web/src/app/api/reports/repeat-no-shows/route.ts`), so the screen and the
 * exported file can never disagree.
 *
 * `row.dates` are `YYYY-MM-DD` strings (BR calendar days, not instants).
 * They are sorted chronologically before formatting: the query groups them
 * by patient in scan order, not date order.
 */
export const REPEAT_NO_SHOW_COLUMNS: ReportColumn<RepeatNoShowRow>[] = [
  {
    key: 'fullName',
    header: 'Paciente',
    value: (row) => row.fullName,
  },
  {
    key: 'phone',
    header: 'Telefone',
    value: (row) => formatBrPhone(row.phone),
  },
  {
    key: 'missedCount',
    header: 'Faltas',
    value: (row) => String(row.missedCount),
    align: 'right',
  },
  {
    key: 'dates',
    header: 'Datas',
    value: (row) => [...row.dates].sort().map((date) => formatDate(date)).join(', '),
  },
  {
    key: 'missedValue',
    header: 'Valor perdido',
    value: (row) => formatCurrency(row.missedValue),
    align: 'right',
  },
]
