import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@/tests/test-utils'
import type { QuotationLine } from '@/validations/face-diagram-group'

const TOXIN = '11111111-1111-4111-8111-111111111111'
const FILLER = '22222222-2222-4222-8222-222222222222'

vi.mock('@/hooks/queries/use-procedure-types', () => ({
  useProcedureTypes: () => ({
    data: [
      { id: TOXIN, name: 'Toxina', defaultPrice: '900.00', isActive: true },
      { id: FILLER, name: 'Preenchimento', defaultPrice: '1200.00', isActive: true },
    ],
  }),
}))

import { QuotationLinesEditor } from '../quotation-lines-editor'

function Harness({ initial }: { initial: QuotationLine[] }) {
  const [lines, setLines] = useState(initial)
  return <QuotationLinesEditor value={lines} onChange={setLines} />
}

const toxinLine: QuotationLine = {
  procedureTypeId: TOXIN,
  procedureTypeName: 'Toxina',
  sessions: 2,
  unitPrice: 900,
}

describe('QuotationLinesEditor', () => {
  it('recomputes the total when a unit price changes', () => {
    renderWithProviders(<Harness initial={[toxinLine]} />)
    expect(screen.getByTestId('quote-total').textContent).toMatch(/1\.800,00/)

    fireEvent.change(screen.getByLabelText('Valor unitário de Toxina'), {
      target: { value: '1.000,00' },
    })

    expect(screen.getByTestId('quote-total').textContent).toMatch(/2\.000,00/)
  })

  it('does not offer a procedure type that is already in the quote', () => {
    renderWithProviders(<Harness initial={[toxinLine]} />)
    const options = Array.from(
      screen.getByLabelText('Adicionar procedimento').querySelectorAll('option'),
    ).map((o) => o.textContent)
    expect(options).toContain('Preenchimento')
    expect(options).not.toContain('Toxina')
  })

  it('prefills the default price when adding a type', () => {
    renderWithProviders(<Harness initial={[]} />)
    fireEvent.change(screen.getByLabelText('Adicionar procedimento'), {
      target: { value: FILLER },
    })
    expect(screen.getByTestId('quote-total').textContent).toMatch(/1\.200,00/)
  })
})
