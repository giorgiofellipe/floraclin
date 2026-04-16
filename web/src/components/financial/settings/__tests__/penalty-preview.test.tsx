import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PenaltyPreview } from '../penalty-preview'

describe('PenaltyPreview', () => {
  it('renders correct calculation for percentage fine type', () => {
    render(
      <PenaltyPreview
        fineType="percentage"
        fineValue={2}
        monthlyInterestPercent={1}
        gracePeriodDays={0}
      />
    )

    const preview = screen.getByTestId('penalty-preview')
    // 2% of 1000 = 20, 1% monthly for 30 days = 10, total = 1030
    expect(preview).toHaveTextContent('multa R$20,00')
    expect(preview).toHaveTextContent('juros R$10,00')
    expect(preview).toHaveTextContent('R$1.030,00')
  })

  it('renders correct calculation for fixed fine type', () => {
    render(
      <PenaltyPreview
        fineType="fixed"
        fineValue={15}
        monthlyInterestPercent={1}
        gracePeriodDays={0}
      />
    )

    const preview = screen.getByTestId('penalty-preview')
    // Fixed 15, 1% monthly for 30 days = 10, total = 1025
    expect(preview).toHaveTextContent('multa R$15,00')
    expect(preview).toHaveTextContent('juros R$10,00')
    expect(preview).toHaveTextContent('R$1.025,00')
  })

  it('renders zero penalties when values are zero', () => {
    render(
      <PenaltyPreview
        fineType="percentage"
        fineValue={0}
        monthlyInterestPercent={0}
        gracePeriodDays={0}
      />
    )

    const preview = screen.getByTestId('penalty-preview')
    expect(preview).toHaveTextContent('multa R$0,00')
    expect(preview).toHaveTextContent('juros R$0,00')
    expect(preview).toHaveTextContent('R$1.000,00')
  })

  it('caps fixed fine at 2% of amount', () => {
    render(
      <PenaltyPreview
        fineType="fixed"
        fineValue={50}
        monthlyInterestPercent={0}
        gracePeriodDays={0}
      />
    )

    const preview = screen.getByTestId('penalty-preview')
    // Fixed 50 capped at 2% of 1000 = 20
    expect(preview).toHaveTextContent('multa R$20,00')
  })

  it('shows grace period info when set', () => {
    render(
      <PenaltyPreview
        fineType="percentage"
        fineValue={2}
        monthlyInterestPercent={1}
        gracePeriodDays={5}
      />
    )

    expect(screen.getByTestId('penalty-preview')).toHaveTextContent('carência de 5 dias')
  })
})
