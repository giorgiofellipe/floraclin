import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { FinancialOverview as Overview } from '@/db/queries/financial'
import { FinancialOverview } from '../financial-overview'

const useFinancialOverviewMock = vi.fn()
vi.mock('@/hooks/queries/use-financial', () => ({
  useFinancialOverview: (month: string) => useFinancialOverviewMock(month),
}))
vi.mock('../cash-flow-chart', () => ({ CashFlowChart: () => null }))

const brl = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)

function overview(overrides: Partial<Overview> = {}): Overview {
  return {
    month: '2026-11',
    monthStart: '2026-11-01',
    monthEnd: '2026-11-30',
    summary: { totalReceived: 36000, totalExpenses: 8400, totalCardFees: 0, netProfit: 27600 },
    receivables: { overdue: { total: 1500, patientCount: 3 }, dueSoon: { total: 900, count: 2 } },
    monthly: [{ month: '2026-11', received: 36000, expenses: 8400 }],
    byProcedureType: [],
    byPaymentMethod: [],
    ...overrides,
  }
}

describe('FinancialOverview', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-14T15:00:00.000Z'))
    useFinancialOverviewMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens each number on the list it sums, for the month shown', () => {
    useFinancialOverviewMock.mockReturnValue({ data: overview(), isPending: false, isError: false })
    render(<FinancialOverview />)

    const link = (name: RegExp) => screen.getByRole('link', { name }).getAttribute('href')
    expect(link(/Recebido/)).toBe('/financeiro?tab=ledger&type=inflow&dateFrom=2026-11-01&dateTo=2026-11-30')
    expect(link(/Despesas pagas/)).toBe('/financeiro?tab=ledger&type=outflow&dateFrom=2026-11-01&dateTo=2026-11-30')
    expect(link(/Taxas de cartão/)).toBe('/financeiro?tab=card-repasses')
    expect(link(/Ver vencidos/)).toBe('/financeiro?tab=receivables&isOverdue=true')
    expect(link(/Ver a receber/)).toBe('/financeiro?tab=receivables&status=pending')
    expect(screen.getByTestId('overview-overdue')).toHaveTextContent('3 pacientes em atraso hoje')
  })

  it('starts on the current month and loads the one picked', () => {
    useFinancialOverviewMock.mockReturnValue({ data: overview(), isPending: false, isError: false })
    render(<FinancialOverview />)

    expect(useFinancialOverviewMock).toHaveBeenLastCalledWith('2026-11')
    fireEvent.click(screen.getByRole('button', { name: 'Mês anterior' }))
    expect(useFinancialOverviewMock).toHaveBeenLastCalledWith('2026-10')
  })

  it('ranks the five largest procedures and sums the rest as Outros', () => {
    const byProcedureType = [10, 70, 20, 60, 30, 50, 40].map((total, i) => ({ name: `P${i}`, total }))
    useFinancialOverviewMock.mockReturnValue({ data: overview({ byProcedureType }), isPending: false, isError: false })
    render(<FinancialOverview />)

    const rows = within(screen.getByText('Recebido por procedimento').closest('[data-slot=card]') as HTMLElement)
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(rows).toEqual([
      `P1${brl(70)}25%`,
      `P3${brl(60)}21%`,
      `P5${brl(50)}18%`,
      `P6${brl(40)}14%`,
      `P4${brl(30)}11%`,
      `Outros${brl(30)}11%`,
    ])
  })

  it('shows one next step instead of empty numbers to a clinic with nothing recorded', () => {
    useFinancialOverviewMock.mockReturnValue({
      data: overview({
        summary: { totalReceived: 0, totalExpenses: 0, totalCardFees: 0, netProfit: 0 },
        receivables: { overdue: { total: 0, patientCount: 0 }, dueSoon: { total: 0, count: 0 } },
        monthly: [{ month: '2026-11', received: 0, expenses: 0 }],
      }),
      isPending: false,
      isError: false,
    })
    render(<FinancialOverview />)

    expect(screen.getByTestId('overview-empty')).toHaveTextContent('Seu lucro aparece aqui quando você registrar pagamentos e despesas.')
    expect(screen.queryByTestId('overview-profit')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Lançar despesa/ })).toHaveAttribute('href', '/financeiro?tab=expenses&novo=1')
  })
})
