import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FinancialList } from '../financial-list'
import { createWrapper } from '@/tests/test-utils'
import { brToday, shiftBrYmd } from '@/lib/dates'

const nav = vi.hoisted(() => ({ replace: vi.fn(), params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: nav.replace, prefetch: vi.fn() }),
  usePathname: () => '/financeiro',
  useSearchParams: () => nav.params,
}))

vi.mock('@/components/layout/subscription-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/layout/subscription-access')>()),
  useSubscriptionAccess: () => ({ role: 'receptionist', readOnly: false }),
  useWriteGuard: () => (action: () => void) => action,
}))

vi.mock('@/hooks/queries/use-installment-quote', () => ({
  useInstallmentQuote: () => ({ data: { totalDue: 412.5 }, error: null }),
}))

const mockBulkPay = vi.fn().mockResolvedValue({})
vi.mock('@/hooks/mutations/use-financial-mutations', () => ({
  ApiError: class extends Error {},
  useBulkPay: () => ({ mutateAsync: mockBulkPay, isPending: false }),
  useBulkCancel: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBulkUncancel: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('../account-select', () => ({ AccountSelect: () => null }))
vi.mock('../installment-table', () => ({ InstallmentTable: () => null }))
vi.mock('../payment-form', () => ({ PaymentForm: () => null }))
vi.mock('@/components/ui/date-picker', () => ({
  DatePicker: ({ value }: { value?: string }) => <input data-testid="bulk-pay-date" readOnly value={value ?? ''} />,
  DateRangePicker: () => null,
}))

function entry(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    patientId: 'p1',
    patientName: `Paciente ${id}`,
    description: 'Toxina botulínica',
    totalAmount: '400.00',
    installmentCount: 1,
    status: 'pending',
    paymentMethod: 'cash',
    notes: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    paidInstallments: 0,
    isOverdue: false,
    nextInstallmentId: `${id}-inst`,
    nextInstallmentNumber: 1,
    nextDueDate: shiftBrYmd(brToday(), 10),
    lastPaidAt: null,
    nextAmountDue: 400,
    ...overrides,
  }
}

const listUrls: string[] = []
function serve(rows: unknown[]) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.startsWith('/api/financial/receivables-totals')) {
      return { ok: true, json: async () => ({ overdue: 0, dueSoon: 0, receivedThisMonth: 0 }) } as Response
    }
    listUrls.push(url)
    return { ok: true, json: async () => ({ data: rows, total: rows.length, totalPages: 1 }) } as Response
  })
}

function renderList() {
  return render(<FinancialList patients={[]} />, { wrapper: createWrapper() })
}

beforeEach(() => {
  nav.params = new URLSearchParams()
  listUrls.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
  mockBulkPay.mockClear()
  nav.replace.mockClear()
})

describe('FinancialList (Recebíveis inbox)', () => {
  it('opens on the charges still to receive, grouped Vencidas / Hoje / Próximas', async () => {
    serve([
      entry('a', { isOverdue: true, nextDueDate: shiftBrYmd(brToday(), -3) }),
      entry('b', { nextDueDate: brToday() }),
      entry('c'),
    ])
    renderList()

    const headings = await screen.findAllByRole('heading', { level: 3 })
    expect(headings.map((h) => h.textContent)).toEqual(['Vencidas', 'Hoje', 'Próximas'])
    expect(listUrls[0]).toContain('status=open')
    expect(within(screen.getByTestId('financial-entry-a')).getByTestId('financial-entry-due')).toHaveTextContent('Vencida há 3 dias')
  })

  it("keeps a patient's tab on the whole history instead of the open charges", async () => {
    serve([entry('a', { status: 'paid', nextInstallmentId: null })])
    render(<FinancialList patients={[]} defaultPatientId="p1" />, { wrapper: createWrapper() })

    await screen.findByTestId('financial-entry-a')
    expect(listUrls[0]).not.toContain('status=')
    expect(screen.queryByTestId('receivables-totals')).not.toBeInTheDocument()
  })

  it('receives the next installment from the row, titled with amount and patient, dated today, in the planned method', async () => {
    serve([entry('a', { totalAmount: '1200.00', installmentCount: 3, nextInstallmentNumber: 2, nextInstallmentId: 'a-inst-2', nextAmountDue: 412.5 })])
    renderList()

    // The row shows what Receber takes now, not the whole charge.
    const row = await screen.findByTestId('financial-entry-a')
    expect(within(row).getAllByText('R$ 412,50').length).toBeGreaterThan(0)
    expect(within(row).getByText('de R$ 1.200,00')).toBeInTheDocument()

    await userEvent.click(await screen.findByTestId('financial-entry-receive'))

    expect(await screen.findByTestId('pay-dialog-title')).toHaveTextContent('Receber R$ 412,50 de Paciente a')
    expect(screen.getByText('Parcela 2 de 3 · Toxina botulínica')).toBeInTheDocument()
    expect(screen.getByTestId('bulk-pay-date')).toHaveValue(brToday())

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar recebimento' }))
    await waitFor(() =>
      expect(mockBulkPay).toHaveBeenCalledWith(
        expect.objectContaining({
          installmentIds: ['a-inst-2'],
          paymentMethod: 'cash',
          paidAt: undefined,
          expectedTotals: { 'a-inst-2': 412.5 },
        }),
      ),
    )
  })

  it('shows no Receber on a paid charge and no checkboxes until Selecionar', async () => {
    serve([entry('a', { status: 'paid', nextInstallmentId: null, lastPaidAt: '2026-11-10T15:00:00.000Z' })])
    renderList()

    await screen.findByTestId('financial-entry-a')
    expect(screen.queryByTestId('financial-entry-receive')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('financial-select-mode'))
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it.each([
    ['', 'Vencido', '?isOverdue=true'],
    ['isOverdue=true', 'Vencido', '?'],
    ['', 'Recebido no mês', '?status=all&receivedThisMonth=true'],
  ])('with "%s", tapping %s filters to "%s"', async (params, tile, expected) => {
    nav.params = new URLSearchParams(params)
    serve([entry('a')])
    renderList()

    await userEvent.click(await screen.findByRole('button', { name: new RegExp(tile) }))
    expect(nav.replace).toHaveBeenLastCalledWith(expected, { scroll: false })
  })

  it('offers Nova cobrança and Agenda when there is nothing to receive', async () => {
    serve([])
    renderList()

    const empty = await screen.findByTestId('financial-empty')
    expect(empty).toHaveTextContent('Nada a receber')
    expect(within(empty).getByRole('button', { name: /Nova cobrança/ })).toBeInTheDocument()
    expect(within(empty).getByRole('link', { name: /Ir para Agenda/ })).toHaveAttribute('href', '/agenda')
  })
})
