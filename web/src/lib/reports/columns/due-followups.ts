import { formatDate } from '@/lib/utils'
import { formatBrPhone } from '@/lib/phone'
import type { DueFollowUpRow } from '@/db/queries/reports/due-followups'
import type { ReportColumn } from '../types'

/**
 * Renders `daysUntil` as a human-readable label rather than a signed
 * integer. Overdue follow-ups (negative `daysUntil`) read as "vencido há N
 * dias", since the point of this report is telling someone who to call, not
 * displaying arithmetic.
 */
function formatDaysUntil(daysUntil: number): string {
  if (daysUntil === 0) return 'Hoje'
  if (daysUntil < 0) {
    const days = Math.abs(daysUntil)
    return `Vencido há ${days} ${days === 1 ? 'dia' : 'dias'}`
  }
  return `Em ${daysUntil} ${daysUntil === 1 ? 'dia' : 'dias'}`
}

/**
 * Column definitions for the "Retornos a vencer" report. Rendered by the
 * on-screen table AND used to build the CSV/PDF exports (see
 * `web/src/app/api/reports/due-followups/route.ts`), so the screen and the
 * exported file can never disagree.
 *
 * `row.followUpDate` is a `YYYY-MM-DD` string (a BR calendar day, not an
 * instant). `formatDate` already knows to parse a bare date string at local
 * noon rather than as UTC midnight, so it is safe to pass straight through.
 */
export const DUE_FOLLOWUP_COLUMNS: ReportColumn<DueFollowUpRow>[] = [
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
    key: 'followUpDate',
    header: 'Data do retorno',
    value: (row) => formatDate(row.followUpDate),
    sortable: true,
  },
  {
    key: 'daysUntil',
    header: 'Dias até',
    value: (row) => formatDaysUntil(row.daysUntil),
    align: 'right',
    sortable: true,
  },
  {
    key: 'procedureTypeName',
    header: 'Procedimento',
    value: (row) => row.procedureTypeName,
  },
]
