/**
 * The "A RECEBER" card shipped as a hardcoded 'R$ 0' for long enough that the
 * painel contradicted the Financeiro screen. These tests assert the card
 * reflects the data it is given, so a literal cannot creep back in unnoticed.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QuickStats } from '../quick-stats'
import type { QuickStats as QuickStatsType } from '@/db/queries/dashboard'

function statsWith(overrides: Partial<QuickStatsType> = {}): QuickStatsType {
  return {
    patientsThisWeek: 12,
    proceduresThisMonth: 23,
    revenueThisMonth: 34200,
    totalPending: 7800,
    totalExpenses: 8400,
    totalOverdue: 0,
    ...overrides,
  } as QuickStatsType
}

describe('QuickStats', () => {
  it('renders the pending figure it is given, not a constant', () => {
    render(<QuickStats stats={statsWith()} todayCount={4} />)
    expect(screen.getByText('A RECEBER')).toBeInTheDocument()
    expect(screen.getByText('R$ 7,8k')).toBeInTheDocument()
  })

  it('reflects a different pending figure', () => {
    render(<QuickStats stats={statsWith({ totalPending: 15400 })} todayCount={4} />)
    expect(screen.getByText('R$ 15,4k')).toBeInTheDocument()
  })

  it('keeps overdue out of the pending figure and labels it separately', () => {
    // Folding overdue into "A receber" would make the painel disagree with
    // Financeiro, which reports the two as distinct totals.
    render(
      <QuickStats stats={statsWith({ totalPending: 7800, totalOverdue: 1200 })} todayCount={4} />
    )
    expect(screen.getByText('R$ 7,8k')).toBeInTheDocument()
    expect(screen.getByText(/vencido/)).toBeInTheDocument()
  })

  it('omits the overdue sublabel when nothing is overdue', () => {
    render(<QuickStats stats={statsWith({ totalOverdue: 0 })} todayCount={4} />)
    expect(screen.queryByText(/vencido/)).not.toBeInTheDocument()
  })

  it('hides the money cards for practitioners', () => {
    // Practitioners must not see clinic-wide revenue, which the query signals
    // by nulling these fields.
    render(
      <QuickStats
        stats={statsWith({ revenueThisMonth: null, totalPending: null, totalOverdue: null })}
        todayCount={4}
      />
    )
    expect(screen.queryByText('A RECEBER')).not.toBeInTheDocument()
    expect(screen.queryByText('RECEBIDO')).not.toBeInTheDocument()
  })

  it('still shows the non-financial cards', () => {
    render(<QuickStats stats={statsWith()} todayCount={4} />)
    expect(screen.getByText('HOJE')).toBeInTheDocument()
    expect(screen.getByText('ESTE MES')).toBeInTheDocument()
    expect(screen.getByText('23')).toBeInTheDocument()
  })
})
