import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { FinancialPlanField } from '../planning/financial-plan-field'
import type { ProcedurePlanningFormData } from '@/validations/procedure'

type Plan = NonNullable<ProcedurePlanningFormData['financialPlan']>

let latestPlan: Plan | undefined

function Harness({ initial }: { initial: Plan }) {
  const form = useForm<ProcedurePlanningFormData>({
    defaultValues: { financialPlan: initial } as ProcedurePlanningFormData,
  })
  latestPlan = form.watch('financialPlan')
  return <FinancialPlanField control={form.control} form={form} hideTotalAmount />
}

const basePlan: Plan = {
  totalAmount: 600,
  installmentCount: 6,
  paymentMethod: 'credit_card',
  notes: '',
}

const installmentTrigger = () => screen.getAllByRole('combobox')[0]
const methodTrigger = () => screen.getAllByRole('combobox')[1]

describe('<FinancialPlanField> debit card', () => {
  it('resets 6 installments to 1 and locks the installment select when the method becomes debit card', async () => {
    const user = userEvent.setup()
    render(<Harness initial={basePlan} />)
    expect(installmentTrigger()).toHaveTextContent('6x')
    expect(installmentTrigger()).toBeEnabled()

    await user.click(methodTrigger())
    await user.click(await screen.findByRole('option', { name: 'Cartão de Débito' }))

    await waitFor(() => expect(latestPlan?.paymentMethod).toBe('debit_card'))
    expect(latestPlan?.installmentCount).toBe(1)
    expect(installmentTrigger()).toHaveTextContent('1x')
    expect(installmentTrigger()).toBeDisabled()
  })

  it('keeps the chosen installment count and leaves the select enabled for credit card', async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ ...basePlan, paymentMethod: 'pix' }} />)

    await user.click(methodTrigger())
    await user.click(await screen.findByRole('option', { name: 'Cartão de Crédito' }))

    await waitFor(() => expect(latestPlan?.paymentMethod).toBe('credit_card'))
    expect(latestPlan?.installmentCount).toBe(6)
    expect(installmentTrigger()).toBeEnabled()
  })
})
