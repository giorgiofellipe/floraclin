import { describe, it, expect } from 'vitest'
import { toCsv, csvFilename } from '../csv'
import type { ReportColumn } from '../types'

interface Row {
  name: string
  notes: string
}

const columns: ReportColumn<Row>[] = [
  { key: 'name', header: 'Nome', value: (row) => row.name },
  { key: 'notes', header: 'Observações', value: (row) => row.notes },
]

describe('toCsv', () => {
  it('emits the header row in column order', () => {
    const csv = toCsv<Row>([], columns)
    expect(csv).toBe('Nome,Observações')
  })

  it('emits only the header row when there are no rows', () => {
    const csv = toCsv<Row>([], columns)
    expect(csv.split('\r\n')).toHaveLength(1)
  })

  it('quotes a value containing a comma', () => {
    const csv = toCsv<Row>([{ name: 'Silva, Maria', notes: '' }], columns)
    expect(csv).toBe('Nome,Observações\r\n"Silva, Maria",')
  })

  it('escapes embedded double quotes by doubling them', () => {
    const csv = toCsv<Row>([{ name: 'Paciente "VIP"', notes: '' }], columns)
    expect(csv).toBe('Nome,Observações\r\n"Paciente ""VIP""",')
  })

  it('quotes a value containing a newline', () => {
    const csv = toCsv<Row>([{ name: 'Ana', notes: 'linha 1\nlinha 2' }], columns)
    expect(csv).toBe('Nome,Observações\r\nAna,"linha 1\nlinha 2"')
  })

  it.each(['=', '+', '-', '@'])('prefixes a value starting with %s to prevent formula injection', (prefix) => {
    const csv = toCsv<Row>([{ name: `${prefix}CMD|'/C calc'!A1`, notes: '' }], columns)
    const dataLine = csv.split('\r\n')[1]
    expect(dataLine.startsWith(`'${prefix}`)).toBe(true)
  })

  it('quotes and prefixes a formula-injection value that also contains a comma', () => {
    const csv = toCsv<Row>([{ name: '=SUM(A1, A2)', notes: '' }], columns)
    expect(csv).toBe('Nome,Observações\r\n"\'=SUM(A1, A2)",')
  })

  it('renders rows through column.value, matching the table', () => {
    const csv = toCsv<Row>([{ name: 'Ana', notes: 'ok' }], columns)
    expect(csv).toBe('Nome,Observações\r\nAna,ok')
  })
})

describe('csvFilename', () => {
  it('combines the report slug and the given date', () => {
    expect(csvFilename('pacientes-inativos', '2026-08-03')).toBe('pacientes-inativos-2026-08-03.csv')
  })
})
