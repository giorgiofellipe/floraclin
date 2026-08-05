import { formatCurrency, formatDate } from '@/lib/utils'
import { toBrYmd } from '@/lib/dates'
import type { LedgerReportRow } from '@/db/queries/reports/extrato-periodo'
import type { ReportColumn } from '../types'

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'PIX',
  credit_card: 'Cartão de Crédito',
  debit_card: 'Cartão de Débito',
  cash: 'Dinheiro',
  transfer: 'Transferência',
}

/**
 * Column definitions for the "Extrato por período" report's on-screen table
 * and PDF export. The CSV export does NOT go through these (see
 * `web/src/app/api/reports/extrato-periodo/route.ts`): it calls
 * `exportLedgerCSV` directly so the file stays byte-compatible with the
 * pre-existing `/api/financial/ledger/export` output.
 *
 * `row.movementDate` is a `timestamptz` instant, not a calendar day, so it
 * is converted to a BR calendar day with `toBrYmd` before formatting rather
 * than passed straight to `formatDate`: this renders correctly whether the
 * host runs BR time (the browser, effectively) or UTC (the PDF renderer).
 */
export const LEDGER_REPORT_COLUMNS: ReportColumn<LedgerReportRow>[] = [
  {
    key: 'movementDate',
    header: 'Data',
    value: (row) => formatDate(toBrYmd(row.movementDate)),
    sortable: true,
  },
  {
    key: 'type',
    header: 'Tipo',
    value: (row) => (row.type === 'inflow' ? 'Entrada' : 'Saída'),
    sortable: true,
  },
  {
    key: 'description',
    header: 'Descrição',
    value: (row) => row.description,
  },
  {
    key: 'reference',
    header: 'Paciente/Categoria',
    value: (row) => row.patientName ?? row.categoryName ?? '-',
  },
  {
    key: 'paymentMethod',
    header: 'Método',
    value: (row) =>
      row.paymentMethod ? (PAYMENT_METHOD_LABELS[row.paymentMethod] ?? row.paymentMethod) : '-',
  },
  {
    key: 'amount',
    header: 'Valor',
    value: (row) => `${row.type === 'outflow' ? '-' : ''}${formatCurrency(row.amount)}`,
    align: 'right',
    sortable: true,
  },
]
