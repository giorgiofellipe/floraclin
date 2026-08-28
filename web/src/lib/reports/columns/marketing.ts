import { formatCurrency } from '@/lib/utils'
import type { MarketingReportRow } from '@/db/queries/reports/marketing'
import type { ReportColumn } from '../types'

const PERCENT_FORMATTER = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 })

/** Column definitions for the "Desempenho de campanhas" report. */
export const MARKETING_REPORT_COLUMNS: ReportColumn<MarketingReportRow>[] = [
  {
    key: 'adLabel',
    header: 'Anúncio',
    value: (row) => row.adLabel,
    sortable: true,
  },
  {
    key: 'leads',
    header: 'Leads',
    value: (row) => String(row.leads),
    align: 'right',
    sortable: true,
  },
  {
    key: 'contacted',
    header: 'Contatados',
    value: (row) => String(row.contacted),
    align: 'right',
    sortable: true,
  },
  {
    key: 'scheduled',
    header: 'Agendados',
    value: (row) => String(row.scheduled),
    align: 'right',
    sortable: true,
  },
  {
    key: 'converted',
    header: 'Convertidos',
    value: (row) => String(row.converted),
    align: 'right',
    sortable: true,
  },
  {
    key: 'revenue',
    header: 'Receita',
    value: (row) => formatCurrency(row.revenue),
    align: 'right',
    sortable: true,
  },
  {
    key: 'conversionRate',
    header: 'Taxa de conversão',
    value: (row) => PERCENT_FORMATTER.format(row.conversionRate),
    align: 'right',
    sortable: true,
  },
]
