import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReportPdf } from '../report-pdf'
import type { ReportColumn } from '@/lib/reports/types'

interface Row {
  name: string
  total: number
}

const COLUMNS: ReportColumn<Row>[] = [
  { key: 'name', header: 'Nome', value: (row) => row.name },
  { key: 'total', header: 'Total', align: 'right', value: (row) => String(row.total) },
]

describe('ReportPdf', () => {
  it('renders the FloraClin brand mark alongside the clinic name and rows', () => {
    render(
      <ReportPdf<Row>
        clinicName="Clínica Teste"
        reportTitle="Procedimentos realizados"
        filterSummary="Período: 01/01/2026 a 31/01/2026"
        rows={[{ name: 'Ana Souza', total: 3 }]}
        columns={COLUMNS}
        generatedAt={new Date('2026-08-05T12:00:00Z')}
      />,
    )

    expect(screen.getByText('FloraClin')).toBeInTheDocument()
    expect(screen.getByText('Clínica Teste')).toBeInTheDocument()
    expect(screen.getByText('Procedimentos realizados')).toBeInTheDocument()
    expect(screen.getByText('Ana Souza')).toBeInTheDocument()
  })

  it('renders the empty-state row when there are no results', () => {
    render(
      <ReportPdf<Row>
        clinicName="Clínica Teste"
        reportTitle="Procedimentos realizados"
        filterSummary=""
        rows={[]}
        columns={COLUMNS}
        generatedAt={new Date('2026-08-05T12:00:00Z')}
      />,
    )

    expect(screen.getByText('Nenhum registro encontrado para os filtros selecionados.')).toBeInTheDocument()
  })
})
