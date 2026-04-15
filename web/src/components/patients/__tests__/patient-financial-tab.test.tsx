import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/tests/test-utils'
import { PatientFinancialTab } from '../patient-financial-tab'

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/financial/payment-form', () => ({
  PaymentForm: () => null,
}))

vi.mock('@/components/financial/installment-table', () => ({
  InstallmentTable: () => <div data-testid="installment-table">InstallmentTable</div>,
}))

vi.mock('@/components/financial/renegotiation-dialog', () => ({
  RenegotiationDialog: () => null,
}))

vi.mock('@/components/financial/bulk-action-bar', () => ({
  BulkActionBar: () => null,
}))

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    patientId: 'patient-1',
    patientName: 'Maria Silva',
    description: 'Botox frontal',
    totalAmount: '1000.00',
    installmentCount: 2,
    status: 'pending',
    notes: null,
    createdAt: new Date('2026-01-15'),
    paidInstallments: 0,
    totalFineAmount: 0,
    totalInterestAmount: 0,
    totalAmountPaid: 0,
    isOverdue: false,
    isPartial: false,
    renegotiatedAt: null,
    renegotiationLinks: [],
    ...overrides,
  }
}

function setup(entries: ReturnType<typeof makeEntry>[] = [makeEntry()]) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ data: entries, total: entries.length, totalPages: 1 }),
  } as Response)

  return renderWithProviders(
    <PatientFinancialTab patientId="patient-1" patientName="Maria Silva" />,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// ─── Tests ─────────────────────────────────────────────────────────

describe('PatientFinancialTab', () => {
  it('renders Multa/Juros labels for overdue entries with penalties', async () => {
    setup([
      makeEntry({
        id: 'entry-overdue',
        status: 'overdue',
        isOverdue: true,
        totalFineAmount: 20,
        totalInterestAmount: 5.5,
      }),
    ])

    // Wait for the entry to load
    await screen.findAllByText('Botox frontal')
    // FinancialList renders penalty info inline as "Multa R$..." / "Juros R$..."
    expect(screen.getByText(/^Multa\s*R\$/)).toBeInTheDocument()
    expect(screen.getByText(/^Juros\s*R\$/)).toBeInTheDocument()
  })

  it('does not render penalty labels when no penalties on pending entry', async () => {
    setup([makeEntry({ status: 'pending', totalFineAmount: 0, totalInterestAmount: 0 })])

    await screen.findAllByText('Botox frontal')
    expect(screen.queryByText(/^Multa\s*R\$/)).toBeNull()
    expect(screen.queryByText(/^Juros\s*R\$/)).toBeNull()
  })

  it('shows "Renegociado" label when entry was renegotiated', async () => {
    setup([
      makeEntry({
        id: 'entry-old',
        status: 'renegotiated',
        renegotiationLinks: [
          { originalEntryId: 'entry-old', newEntryId: 'entry-new-1234' },
        ],
      }),
    ])

    await screen.findAllByText('Botox frontal')
    // Renegotiated entries render both a status badge and an inline label — expect at least one.
    expect(screen.getAllByText('Renegociado').length).toBeGreaterThanOrEqual(1)
  })

  it('shows "Renegociação" label when entry originates from renegotiation', async () => {
    setup([
      makeEntry({
        id: 'entry-new',
        status: 'pending',
        renegotiationLinks: [
          { originalEntryId: 'entry-old-abcd', newEntryId: 'entry-new' },
        ],
      }),
    ])

    await screen.findAllByText('Botox frontal')
    expect(screen.getByText('Renegociação')).toBeInTheDocument()
  })

  it('shows the "Nova Cobrança" button', async () => {
    setup()

    const btn = await screen.findByRole('button', { name: /Nova Cobrança/i })
    expect(btn).toBeInTheDocument()
  })

  it('shows the patient-tab financial summary cards with correct totals', async () => {
    setup([
      makeEntry({
        id: 'e1',
        status: 'pending',
        totalAmount: '500.00',
        totalFineAmount: 0,
        totalInterestAmount: 0,
        totalAmountPaid: 0,
      }),
      makeEntry({
        id: 'e2',
        status: 'overdue',
        isOverdue: true,
        totalAmount: '300.00',
        totalFineAmount: 10,
        totalInterestAmount: 5,
        totalAmountPaid: 50,
      }),
      makeEntry({
        id: 'e3',
        status: 'paid',
        totalAmount: '200.00',
        totalFineAmount: 0,
        totalInterestAmount: 0,
        totalAmountPaid: 200,
        paidInstallments: 1,
      }),
    ])

    await screen.findAllByText('Botox frontal')

    // Summary cards at the top of PatientFinancialTab use "Pendente", "Atrasado", "Pago" labels.
    // Each may also appear as a status badge on a matching entry, so use getAllByText.
    expect(screen.getAllByText('Pendente').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Atrasado').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Pago').length).toBeGreaterThanOrEqual(1)

    // Summary totals: pending=500, overdue=300+10+5-50=265, paid=200+0+0=200
    // formatCurrency renders like "R$ 500,00". The same amount may appear on both
    // a summary card and an entry row — assert "at least one occurrence".
    expect(screen.getAllByText(/R\$\s*500,00/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/R\$\s*265,00/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/R\$\s*200,00/).length).toBeGreaterThanOrEqual(1)
  })

  it('shows empty state when no charges exist', async () => {
    setup([])

    expect(await screen.findByText('Nenhuma cobrança registrada')).toBeInTheDocument()
  })

  it('shows the total registros count', async () => {
    setup([makeEntry(), makeEntry({ id: 'e2', description: 'Preenchimento labial' })])

    // FinancialList renders "{total} registros" (plural) in its top bar.
    expect(await screen.findByText('2 registros')).toBeInTheDocument()
  })
})
