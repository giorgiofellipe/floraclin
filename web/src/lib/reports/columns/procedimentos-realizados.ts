import { formatDate } from '@/lib/utils'
import { toBrYmd } from '@/lib/dates'
import type { ProcedureApplicationRow } from '@/db/queries/reports/procedimentos-realizados'
import type { ReportColumn } from '../types'

/**
 * Column definitions for the "Procedimentos realizados" report: the
 * lot-level traceability log, one row per `product_applications` record.
 *
 * `row.performedAt` is a `timestamptz` instant, so it is converted to a BR
 * calendar day with `toBrYmd` before formatting rather than passed straight
 * to `formatDate`: this renders correctly whether the host runs BR time
 * (the browser) or UTC (the PDF renderer, per `web/src/lib/pdf.ts`).
 * `row.expirationDate` is already a bare `YYYY-MM-DD` (a `date` column, not
 * an instant), which `formatDate` parses safely on its own.
 */
export const PROCEDURE_APPLICATION_COLUMNS: ReportColumn<ProcedureApplicationRow>[] = [
  {
    key: 'performedAt',
    header: 'Data',
    value: (row) => formatDate(toBrYmd(row.performedAt)),
    sortable: true,
  },
  {
    key: 'patientName',
    header: 'Paciente',
    value: (row) => row.patientName,
    sortable: true,
  },
  {
    key: 'practitionerName',
    header: 'Profissional',
    value: (row) => row.practitionerName,
    sortable: true,
  },
  {
    key: 'productName',
    header: 'Produto',
    value: (row) => row.productName,
    sortable: true,
  },
  {
    key: 'activeIngredient',
    header: 'Princípio ativo',
    value: (row) => row.activeIngredient ?? '-',
  },
  {
    key: 'quantity',
    header: 'Quantidade',
    value: (row) => `${row.totalQuantity} ${row.quantityUnit}`,
    align: 'right',
  },
  {
    key: 'batchNumber',
    header: 'Lote',
    value: (row) => row.batchNumber ?? '-',
  },
  {
    key: 'expirationDate',
    header: 'Validade',
    value: (row) => (row.expirationDate ? formatDate(row.expirationDate) : '-'),
  },
]
