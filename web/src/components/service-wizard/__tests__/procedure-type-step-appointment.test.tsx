import React, { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProcedureTypeStep } from '../procedure-type-step'
import type { EncounterCart } from '@/validations/encounter-cart'

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

const types = [
  { id: 't-botox', name: 'Botox', category: 'botox', defaultPrice: '850.00', estimatedDurationMin: 30 },
  { id: 't-filler', name: 'Preenchimento', category: 'filler', defaultPrice: '1200.00', estimatedDurationMin: 45 },
]

function Harness({ onCart, appointmentTypeId }: { onCart: (c: EncounterCart) => void; appointmentTypeId: string | null }) {
  const [cart, setCart] = useState(emptyCart)
  return (
    <ProcedureTypeStep
      patientId="p1"
      cart={cart}
      onCartChange={(c) => {
        onCart(c)
        setCart(c)
      }}
      appointmentTypeId={appointmentTypeId}
    />
  )
}

function renderStep(appointmentTypeId: string | null) {
  const onCart = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <Harness onCart={onCart} appointmentTypeId={appointmentTypeId} />
    </QueryClientProvider>,
  )
  return onCart
}

describe('ProcedureTypeStep opened from an appointment', () => {
  beforeEach(() => {
    mockGroups.mockReset().mockReturnValue([])
    global.fetch = vi.fn(async (url: string) =>
      new Response(JSON.stringify(String(url).includes('procedure-types') ? types : [])),
    ) as unknown as typeof fetch
  })

  it('prefills the booked procedure type at its catalog price', async () => {
    const onCart = renderStep('t-botox')
    await waitFor(() => expect(onCart).toHaveBeenCalled())
    expect(onCart.mock.calls[0][0].lines).toEqual([
      expect.objectContaining({ procedureTypeId: 't-botox', defaultPrice: 850, sessions: 1 }),
    ])
  })

  it('still offers a saved quotation over the prefilled type', async () => {
    mockGroups.mockReturnValue([
      {
        id: 'g1',
        status: 'quote',
        createdAt: '2026-10-20T15:00:00.000Z',
        quotationLines: [{ procedureTypeId: 't-filler', procedureTypeName: 'Preenchimento', sessions: 1, unitPrice: 1000 }],
      },
    ])
    const onCart = renderStep('t-botox')
    await waitFor(() => expect(onCart).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Usar orçamento' }))

    expect(onCart.mock.lastCall?.[0].lines).toEqual([
      expect.objectContaining({ procedureTypeId: 't-filler', defaultPrice: 1000 }),
    ])
  })
})
