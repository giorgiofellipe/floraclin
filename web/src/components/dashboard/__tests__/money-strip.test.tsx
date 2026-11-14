import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { QuickStats } from '@/db/queries/dashboard'

vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))

import { MoneyStrip } from '../money-strip'

const STATS: QuickStats = {
  patientsThisWeek: 3,
  proceduresThisMonth: 10,
  revenueThisMonth: 10000,
  totalPending: 2500,
  totalExpenses: 3000,
  totalOverdue: 400,
  totalCardFees: 200,
}

function figure(label: string) {
  return screen.getByText(label).nextElementSibling?.textContent?.replace(/\s/g, ' ')
}

function renderStrip(stats: Partial<QuickStats> = {}, monthlyGoal = 0) {
  return render(<MoneyStrip stats={{ ...STATS, ...stats }} month="2026-11" currentMonth="2026-11" onMonthChange={() => {}} monthlyGoal={monthlyGoal} />)
}

describe('MoneyStrip', () => {
  // Overdue is its own figure, never folded into "A receber"; profit takes out expenses and card fees.
  it('shows received, pending, overdue and net profit from the stats it is given', () => {
    renderStrip()
    expect(figure('Recebido')).toBe('R$ 10.000,00')
    expect(figure('A receber')).toBe('R$ 2.500,00')
    expect(figure('Vencido')).toBe('R$ 400,00')
    expect(figure('Lucro líquido')).toBe('R$ 6.800,00')
    expect(screen.getByRole('link', { name: 'Ver cobranças vencidas' })).toHaveAttribute('href', '/financeiro?tab=receivables&isOverdue=true')
    expect(screen.getByText('Despesas R$ 3.000,00 · Taxas R$ 200,00')).toBeInTheDocument()
  })

  it('renders nothing for practitioners, whose money figures are null', () => {
    const { container } = renderStrip({ revenueThisMonth: null, totalPending: null, totalExpenses: null, totalOverdue: null, totalCardFees: null }, 50000)
    expect(container).toBeEmptyDOMElement()
  })

  // The selector lives in this card, so a quiet month must not take it away.
  it('keeps the month selector when nothing moved in the month', () => {
    renderStrip({ revenueThisMonth: 0, totalPending: 0, totalExpenses: 0, totalOverdue: 0, totalCardFees: 0 })
    expect(screen.getByText('Nenhum valor neste mês.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /mês anterior/i })).toBeInTheDocument()
  })

  it.each([
    [0, false],
    [20000, true],
  ])('with a monthly goal of %i shows the goal bar: %s', (goal, shown) => {
    renderStrip({}, goal)
    expect(screen.queryByRole('progressbar', { name: 'Meta do mês' }) !== null).toBe(shown)
  })
})
