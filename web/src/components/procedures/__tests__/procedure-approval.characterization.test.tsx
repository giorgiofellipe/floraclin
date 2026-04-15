import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProcedureApproval } from '../procedure-approval'

const mockApprove = vi.fn(async () => ({ data: { id: 'proc-id' } }))
const mockAcceptConsent = vi.fn(async () => ({ data: {} }))

vi.mock('@/hooks/mutations/use-procedure-mutations', () => ({
  useApproveProcedure: () => ({ mutateAsync: mockApprove, isPending: false }),
}))

vi.mock('@/hooks/mutations/use-consent-mutations', () => ({
  useAcceptConsent: () => ({ mutateAsync: mockAcceptConsent, isPending: false }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function installFetchMock() {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()

    // Procedure types list
    if (url.includes('/api/procedure-types')) {
      return new Response(
        JSON.stringify([
          { id: 'proc-type-id', name: 'Botox', category: 'botox' },
        ]),
        { status: 200 },
      )
    }

    // Consent status — already signed for all relevant types
    if (url.includes('/api/consent/history') || url.includes('/api/consent/status')) {
      return new Response(
        JSON.stringify({ signed: true, signedAt: new Date().toISOString() }),
        { status: 200 },
      )
    }

    // Consent template (contract) — pre-signed
    if (url.includes('/api/consent/templates')) {
      return new Response(
        JSON.stringify({
          id: 'contract-template-id',
          type: 'service_contract',
          title: 'Contrato de Serviço',
          content: 'Termos...',
          version: 1,
        }),
        { status: 200 },
      )
    }

    return new Response(JSON.stringify([]), { status: 200 })
  }) as unknown as typeof fetch
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('ProcedureApproval — characterization', () => {
  beforeEach(() => {
    mockApprove.mockClear()
    mockAcceptConsent.mockClear()
    installFetchMock()
  })

  it('does not call approveProcedure on mount when preconditions are not yet met', () => {
    const fixtureProcedure = {
      id: 'proc-id',
      procedureTypeId: 'proc-type-id',
      status: 'planned',
      financialPlan: { totalAmount: 1500, installmentCount: 3 },
    } as never

    renderWithProviders(
      <ProcedureApproval
        procedure={fixtureProcedure}
        diagrams={[]}
        patient={{ id: 'patient-id', fullName: 'Maria Silva', gender: 'female' }}
        tenant={{ id: 'tenant-id', name: 'Clínica Flora' }}
        additionalTypeIds={[]}
        wizardOverrides={{
          hideSaveButton: true,
          hideNavigation: true,
          hideTitle: true,
          triggerSave: 0,
        }}
      />,
    )

    expect(mockApprove).not.toHaveBeenCalled()
  })

  // Additional tests may be added once the form's async state is stable enough
  // to reliably reach canApprove === true in a test environment. For now, the
  // characterization test guards against regressions in "don't approve on mount"
  // behavior, which is the structural invariant the C2 migration must preserve.
})
