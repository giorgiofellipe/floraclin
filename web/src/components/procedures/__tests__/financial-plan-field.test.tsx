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

const methodTrigger = () => screen.getAllByRole('combobox')[0]
const installmentTrigger = () => screen.getAllByRole('combobox')[1]

async function pickMethod(name: string) {
  const user = userEvent.setup()
  await user.click(methodTrigger())
  await user.click(await screen.findByRole('option', { name }))
}

describe('<FinancialPlanField> payment method and parcelas', () => {
  it('puts the method before the parcelas', () => {
    render(<Harness initial={basePlan} />)
    const labels = screen.getAllByText(/^(Forma de pagamento|Parcelas no cartão)$/).map((el) => el.textContent)
    expect(labels).toEqual(['Forma de pagamento', 'Parcelas no cartão'])
  })

  it('hides the parcelas and stores 1 when the method becomes debit card', async () => {
    render(<Harness initial={basePlan} />)
    expect(installmentTrigger()).toHaveTextContent('6x')

    await pickMethod('Cartão de Débito')

    await waitFor(() => expect(latestPlan?.paymentMethod).toBe('debit_card'))
    expect(latestPlan?.installmentCount).toBe(1)
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    expect(screen.queryByText(/^Parcelas/)).toBeNull()
  })

  it('labels the count as card parcelas for credit card and keeps it', async () => {
    render(<Harness initial={{ ...basePlan, paymentMethod: 'pix' }} />)
    expect(screen.getByText('Parcelas')).toBeInTheDocument()

    await pickMethod('Cartão de Crédito')

    await waitFor(() => expect(latestPlan?.paymentMethod).toBe('credit_card'))
    expect(latestPlan?.installmentCount).toBe(6)
    expect(screen.getByText('Parcelas no cartão')).toBeInTheDocument()
    expect(installmentTrigger()).toHaveTextContent('6x')
    expect(installmentTrigger()).toBeEnabled()
  })
})
