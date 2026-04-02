import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PenaltyBadge } from '../penalty-badge'

describe('PenaltyBadge', () => {
  it('renders nothing when no penalties and not paid', () => {
    const { container } = render(
      <PenaltyBadge fineAmount={0} interestAmount={0} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows fine and interest amounts for overdue', () => {
    render(<PenaltyBadge fineAmount={20} interestAmount={10} />)
    const badge = screen.getByTestId('penalty-badge')
    expect(badge).toHaveTextContent('Multa')
    expect(badge).toHaveTextContent('R$')
    expect(badge).toHaveTextContent('Juros')
    expect(badge.className).toContain('amber')
  })

  it('shows only fine when interest is zero', () => {
    render(<PenaltyBadge fineAmount={20} interestAmount={0} />)
    const badge = screen.getByTestId('penalty-badge')
    expect(badge).toHaveTextContent('Multa')
    expect(badge).not.toHaveTextContent('Juros')
  })

  it('shows only interest when fine is zero', () => {
    render(<PenaltyBadge fineAmount={0} interestAmount={10} />)
    const badge = screen.getByTestId('penalty-badge')
    expect(badge).not.toHaveTextContent('Multa')
    expect(badge).toHaveTextContent('Juros')
  })

  it('shows "Encargos pagos" when paid and no remaining penalties', () => {
    render(<PenaltyBadge fineAmount={0} interestAmount={0} isPaid />)
    const badge = screen.getByTestId('penalty-badge')
    expect(badge).toHaveTextContent('Encargos pagos')
    expect(badge.className).toContain('sage')
  })
})
