import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  describe('sortable columns', () => {
    const sortableColumns: ReportColumn<Row>[] = [
      { key: 'name', header: 'Paciente', value: (row) => row.name, sortable: true },
      {
        key: 'amount',
        header: 'Valor',
        value: (row) => `R$ ${row.amount.toFixed(2)}`,
        align: 'right',
        sortable: true,
        sortKey: 'valorTotal',
      },
    ]

    it('renders a non-sortable column header as plain text, not a button', () => {
      render(<ReportTable rows={rows} columns={columns} />)

      expect(screen.queryByRole('button', { name: /Paciente/ })).not.toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'Paciente' })).toBeInTheDocument()
    })

    it('renders a sortable column header as a clickable button', () => {
      render(<ReportTable rows={rows} columns={sortableColumns} />)

      expect(screen.getByRole('button', { name: /Paciente/ })).toBeInTheDocument()
    })

    it('calls onSortChange with the column key when clicked', async () => {
      const onSortChange = vi.fn()
      render(<ReportTable rows={rows} columns={sortableColumns} onSortChange={onSortChange} />)

      await userEvent.click(screen.getByRole('button', { name: /Paciente/ }))

      expect(onSortChange).toHaveBeenCalledWith('name')
    })

    it('calls onSortChange with sortKey rather than key when the two differ', async () => {
      const onSortChange = vi.fn()
      render(<ReportTable rows={rows} columns={sortableColumns} onSortChange={onSortChange} />)

      await userEvent.click(screen.getByRole('button', { name: /Valor/ }))

      expect(onSortChange).toHaveBeenCalledWith('valorTotal')
    })

    it('marks the active ascending column with aria-sort="ascending"', () => {
      render(
        <ReportTable
          rows={rows}
          columns={sortableColumns}
          sort={{ key: 'name', dir: 'asc' }}
        />,
      )

      expect(screen.getByRole('columnheader', { name: /Paciente/ })).toHaveAttribute(
        'aria-sort',
        'ascending',
      )
      expect(screen.getByRole('columnheader', { name: /Valor/ })).toHaveAttribute(
        'aria-sort',
        'none',
      )
    })

    it('marks the active descending column with aria-sort="descending"', () => {
      render(
        <ReportTable
          rows={rows}
          columns={sortableColumns}
          sort={{ key: 'valorTotal', dir: 'desc' }}
        />,
      )

      expect(screen.getByRole('columnheader', { name: /Valor/ })).toHaveAttribute(
        'aria-sort',
        'descending',
      )
    })

    it('does not set aria-sort on non-sortable columns', () => {
      render(<ReportTable rows={rows} columns={columns} sort={{ key: 'name', dir: 'asc' }} />)

      expect(screen.getByRole('columnheader', { name: 'Paciente' })).not.toHaveAttribute(
        'aria-sort',
      )
    })
  })
})
