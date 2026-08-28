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

const TENANT_NO_LOGO = {
  name: 'Clínica Teste',
  phone: '11987654321',
  email: 'contato@clinicateste.com.br',
  logoUrl: null,
  address: { street: 'Rua das Flores', number: '100', city: 'São Paulo', state: 'SP' },
}

const TENANT_WITH_LOGO = {
  ...TENANT_NO_LOGO,
  logoUrl: 'https://storage.example.com/tenant-1/branding/logo.png?token=abc',
}

describe('ReportPdf', () => {
  it('renders the clinic header (name, contact, logo) above the rows', () => {
    render(
      <ReportPdf<Row>
        tenant={TENANT_WITH_LOGO}
        reportTitle="Procedimentos realizados"
        filterSummary="Período: 01/01/2026 a 31/01/2026"
        rows={[{ name: 'Ana Souza', total: 3 }]}
        columns={COLUMNS}
        generatedAt={new Date('2026-08-05T12:00:00Z')}
      />,
    )

    expect(screen.getByText('FloraClin')).toBeInTheDocument()
    expect(screen.getByText('Clínica Teste')).toBeInTheDocument()
    const logo = screen.getByRole('img', { name: 'Clínica Teste' })
    expect(logo).toHaveAttribute('src', TENANT_WITH_LOGO.logoUrl)
    expect(screen.getByText('Procedimentos realizados')).toBeInTheDocument()
    expect(screen.getByText('Ana Souza')).toBeInTheDocument()
  })

  it('renders without throwing and without a logo image when logoUrl is null', () => {
    render(
      <ReportPdf<Row>
        tenant={TENANT_NO_LOGO}
        reportTitle="Procedimentos realizados"
        filterSummary="Período: 01/01/2026 a 31/01/2026"
        rows={[{ name: 'Ana Souza', total: 3 }]}
        columns={COLUMNS}
        generatedAt={new Date('2026-08-05T12:00:00Z')}
      />,
    )

    expect(screen.getByText('Clínica Teste')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders the empty-state row when there are no results', () => {
    render(
      <ReportPdf<Row>
        tenant={TENANT_NO_LOGO}
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
