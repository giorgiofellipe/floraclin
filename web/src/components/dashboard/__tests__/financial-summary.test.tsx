import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FinancialSummary } from '../financial-summary'
import type { QuickStats } from '@/db/queries/dashboard'

function makeStats(overrides: Partial<QuickStats> = {}): QuickStats {
  return {
    patientsThisWeek: 3,
    proceduresThisMonth: 10,
    revenueThisMonth: 5000,
    totalPending: 1200,
    totalExpenses: 800,
    totalOverdue: 300,
    ...overrides,
  }
}

describe('FinancialSummary', () => {
  it('renders the received/pending/expenses figures it is given, not hardcoded constants', () => {
    render(
      <FinancialSummary
        stats={makeStats({ revenueThisMonth: 5432, totalPending: 1234, totalExpenses: 876 })}
        month="2026-04"
      />
    )

    const card = screen.getByTestId('dashboard-financial')
    expect(card).toHaveTextContent('R$ 5.432')
    expect(card).toHaveTextContent('R$ 1.234')
    expect(card).toHaveTextContent('R$ 876')
  })

  it('does not render a hardcoded R$ 0 for "A receber" when pending is non-zero', () => {
    render(
      <FinancialSummary
        stats={makeStats({ totalPending: 999 })}
        month="2026-04"
      />
    )

    // Regression guard: the card used to hardcode receivable = 0, so "A
    // receber" always showed R$ 0 regardless of the real pending total.
    const receivableLabel = screen.getByText('A receber')
    const receivableRow = receivableLabel.closest('div')!.parentElement!
    expect(receivableRow).toHaveTextContent('R$ 999')
    expect(receivableRow).not.toHaveTextContent('R$ 0')
  })

  it('computes lucro liquido as received minus expenses', () => {
    render(
      <FinancialSummary
        stats={makeStats({ revenueThisMonth: 5000, totalExpenses: 1800 })}
        month="2026-04"
      />
    )

    const netProfitLabel = screen.getByText('Lucro liquido')
    const netProfitRow = netProfitLabel.closest('div')!.parentElement!
    // 5000 - 1800 = 3200
    expect(netProfitRow).toHaveTextContent('R$ 3.200')
  })

  it('does not fold totalOverdue into "A receber": only totalPending is shown there', () => {
    render(
      <FinancialSummary
        stats={makeStats({ totalPending: 500, totalOverdue: 700 })}
        month="2026-04"
      />
    )

    const receivableLabel = screen.getByText('A receber')
    const receivableRow = receivableLabel.closest('div')!.parentElement!
    // If overdue leaked in, this would read R$ 1.200 (500 + 700) instead.
    expect(receivableRow).toHaveTextContent('R$ 500')
    expect(receivableRow).not.toHaveTextContent('1.200')
  })

  it('hides all money rows for practitioners (null pending/expenses/received)', () => {
    render(
      <FinancialSummary
        stats={makeStats({ revenueThisMonth: null, totalPending: null, totalExpenses: null, totalOverdue: null })}
        month="2026-04"
      />
    )

    expect(screen.queryByText('Recebido')).not.toBeInTheDocument()
    expect(screen.queryByText('A receber')).not.toBeInTheDocument()
    expect(screen.queryByText('Despesas')).not.toBeInTheDocument()
    expect(screen.queryByText('Lucro liquido')).not.toBeInTheDocument()
    // The header (month/year) still renders.
    expect(screen.getByTestId('dashboard-financial')).toHaveTextContent('Financeiro: Abril')
  })

  it('hides the progress bar for practitioners even when a monthly goal is configured', () => {
    render(
      <FinancialSummary
        stats={makeStats({ revenueThisMonth: null, totalPending: null, totalExpenses: null, totalOverdue: null })}
        month="2026-04"
        monthlyGoal={10000}
      />
    )

    expect(screen.queryByText(/Meta mensal/)).not.toBeInTheDocument()
  })

  it('still shows the progress bar for non-practitioners with a monthly goal', () => {
    render(
      <FinancialSummary
        stats={makeStats({ revenueThisMonth: 5000 })}
        month="2026-04"
        monthlyGoal={10000}
      />
    )

    expect(screen.getByText(/Meta mensal/)).toBeInTheDocument()
    expect(screen.getByText('50% atingido')).toBeInTheDocument()
  })
})
