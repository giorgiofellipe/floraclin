import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProcedureTypeStep } from '../procedure-type-step'
import { computeCartTotal, type EncounterCart } from '@/validations/encounter-cart'

const mockGroups = vi.fn()
vi.mock('@/hooks/queries/use-face-diagram-groups', () => ({
  usePatientDiagramGroups: () => ({ data: mockGroups() }),
}))

const emptyCart: EncounterCart = {
  templateId: null,
  templateName: null,
  templateDefaultPrice: null,
  templateValidityMonths: null,
  lines: [],
  totalOverride: null,
}

const quoteGroup = {
  id: 'g1',
  status: 'quote',
  createdAt: '2026-10-20T15:00:00.000Z',
  quotationLines: [
    { procedureTypeId: '11111111-1111-4111-8111-111111111111', procedureTypeName: 'Botox', sessions: 2, unitPrice: 450.5 },
    { procedureTypeId: '22222222-2222-4222-8222-222222222222', procedureTypeName: 'Preenchimento', sessions: 1, unitPrice: 1200 },
  ],
}

function renderStep(props: Partial<React.ComponentProps<typeof ProcedureTypeStep>> = {}) {
  const onCartChange = vi.fn()
  const onSelect = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <ProcedureTypeStep
        patientId="p1"
        cart={emptyCart}
        onCartChange={onCartChange}
        quoteSelection={{ selectedGroupId: null, onSelect }}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { onCartChange, onSelect }
}

describe('ProcedureTypeStep quotation card', () => {
  beforeEach(() => {
    mockGroups.mockReset()
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify([]), { status: 200 }),
    ) as unknown as typeof fetch
  })

  it('applies the quote lines at their quoted prices and reports the group', async () => {
    mockGroups.mockReturnValue([quoteGroup])
    const { onCartChange, onSelect } = renderStep()

    fireEvent.click(await screen.findByRole('button', { name: 'Usar orçamento' }))

    const cart = onCartChange.mock.calls[0][0] as EncounterCart
    expect(computeCartTotal(cart)).toBe(2 * 450.5 + 1200)
    expect(onSelect).toHaveBeenCalledWith('g1')
  })

  it('shows no card without a quote group', async () => {
    mockGroups.mockReturnValue([{ ...quoteGroup, status: 'applied' }])
    renderStep()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Usar orçamento' })).toBeNull()
  })

  it('applies a quote preselected from the URL without a click', async () => {
    mockGroups.mockReturnValue([quoteGroup])
    const { onCartChange } = renderStep({
      quoteSelection: { selectedGroupId: 'g1', onSelect: vi.fn() },
    })

    await waitFor(() => expect(onCartChange).toHaveBeenCalledTimes(1))
    expect(computeCartTotal(onCartChange.mock.calls[0][0])).toBe(2101)
  })
})
