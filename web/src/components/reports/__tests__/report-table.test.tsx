import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReportTable } from '../report-table'
import type { ReportColumn } from '@/lib/reports/types'

interface Row {
  id: string
  name: string
  amount: number
}

const rows: Row[] = [
  { id: '1', name: 'Ana Souza', amount: 1234.5 },
  { id: '2', name: 'Bruno Lima', amount: 89 },
]

const columns: ReportColumn<Row>[] = [
  { key: 'name', header: 'Paciente', value: (row) => row.name },
  {
    key: 'amount',
    header: 'Valor',
    value: (row) => `R$ ${row.amount.toFixed(2)}`,
    align: 'right',
  },
]

describe('ReportTable', () => {
  it('renders one row per record', () => {
    render(<ReportTable rows={rows} columns={columns} />)

    expect(screen.getByText('Ana Souza')).toBeInTheDocument()
    expect(screen.getByText('Bruno Lima')).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(rows.length + 1) // + header row
  })

  it('applies column.value rather than reading raw fields', () => {
    render(<ReportTable rows={rows} columns={columns} />)

    // The raw numeric amount must never appear unformatted; only the
    // string produced by column.value should be rendered.
    expect(screen.getByText('R$ 1234.50')).toBeInTheDocument()
    expect(screen.getByText('R$ 89.00')).toBeInTheDocument()
    expect(screen.queryByText('1234.5')).not.toBeInTheDocument()
  })

  it('renders headers in column order', () => {
    render(<ReportTable rows={rows} columns={columns} />)

    const headers = screen.getAllByRole('columnheader').map((el) => el.textContent)
    expect(headers).toEqual(['Paciente', 'Valor'])
  })

  it('shows the empty state for zero rows', () => {
    render(<ReportTable rows={[]} columns={columns} />)

    expect(
      screen.getByText('Nenhum registro encontrado para os filtros selecionados.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Ana Souza')).not.toBeInTheDocument()
  })

  it('respects right alignment', () => {
    render(<ReportTable rows={rows} columns={columns} />)

    const amountHeader = screen.getByRole('columnheader', { name: 'Valor' })
    expect(amountHeader.className).toContain('text-right')

    const nameHeader = screen.getByRole('columnheader', { name: 'Paciente' })
    expect(nameHeader.className).not.toContain('text-right')

    const amountCell = screen.getByText('R$ 1234.50')
    expect(amountCell.className).toContain('text-right')

    const nameCell = screen.getByText('Ana Souza')
    expect(nameCell.className).not.toContain('text-right')
  })

  it('has no action column when rowAction is omitted', () => {
    render(<ReportTable rows={rows} columns={columns} />)

    const headers = screen.getAllByRole('columnheader').map((el) => el.textContent)
    expect(headers).toEqual(['Paciente', 'Valor'])
    expect(screen.queryByRole('columnheader', { name: 'WhatsApp' })).not.toBeInTheDocument()

    const firstRowCells = screen.getAllByRole('row')[1].querySelectorAll('td')
    expect(firstRowCells).toHaveLength(columns.length)
  })

  it('renders the rowAction result in a trailing cell per row', () => {
    render(
      <ReportTable
        rows={rows}
        columns={columns}
        rowAction={(row) => <button>Chamar {row.name}</button>}
      />,
    )

    expect(screen.getByRole('columnheader', { name: 'WhatsApp' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Chamar Ana Souza' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Chamar Bruno Lima' })).toBeInTheDocument()

    const firstRowCells = screen.getAllByRole('row')[1].querySelectorAll('td')
    expect(firstRowCells).toHaveLength(columns.length + 1)
  })

  it('spans the action column in the empty state when rowAction is present', () => {
    render(
      <ReportTable
        rows={[]}
        columns={columns}
        rowAction={(row) => <button>Chamar {row.name}</button>}
      />,
    )

    const emptyCell = screen.getByText('Nenhum registro encontrado para os filtros selecionados.')
    expect(emptyCell).toHaveAttribute('colspan', String(columns.length + 1))
  })

  it('applies rowClassName per row without affecting rows that opt out', () => {
    render(
      <ReportTable
        rows={rows}
        columns={columns}
        rowClassName={(row) => (row.id === '1' ? 'bg-red-50' : undefined)}
      />,
    )

    const dataRows = screen.getAllByRole('row').slice(1)
    expect(dataRows[0].className).toContain('bg-red-50')
    expect(dataRows[1].className).not.toContain('bg-red-50')
  })
})
