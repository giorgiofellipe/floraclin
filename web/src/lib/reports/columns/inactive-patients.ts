import { formatCurrency, formatDate } from '@/lib/utils'
import { formatBrPhone } from '@/lib/phone'
import type { InactivePatientRow } from '@/db/queries/reports/inactive-patients'
import type { ReportColumn } from '../types'

/**
 * Column definitions for the "Pacientes inativos" report. Rendered by the
 * on-screen table AND used to build the CSV/PDF exports (see
 * `web/src/app/api/reports/inactive-patients/route.ts`), so the screen and
 * the exported file can never disagree.
 *
 * `row.lastProcedureAt` is a `YYYY-MM-DD` string (a BR calendar day, not an
 * instant). `formatDate` already knows to parse a bare date string at local
 * noon rather than as UTC midnight, so it is safe to pass straight through.
 */
export const INACTIVE_PATIENT_COLUMNS: ReportColumn<InactivePatientRow>[] = [
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
    key: 'lastProcedureAt',
    header: 'Último procedimento',
    value: (row) => (row.lastProcedureAt ? formatDate(row.lastProcedureAt) : 'Nunca atendido'),
  },
  {
    key: 'daysSince',
    header: 'Dias sem retornar',
    value: (row) => String(row.daysSince),
    align: 'right',
  },
  {
    key: 'lastProcedureType',
    header: 'Tipo',
    value: (row) => row.lastProcedureType ?? '-',
  },
  {
    key: 'lifetimeValue',
    header: 'Valor total',
    value: (row) => formatCurrency(row.lifetimeValue),
    align: 'right',
  },
]
