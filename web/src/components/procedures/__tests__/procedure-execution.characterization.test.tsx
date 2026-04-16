import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProcedureExecution } from '../procedure-execution'

const mockExecute = vi.fn(async () => ({ data: { id: 'proc-id' } }))
const mockUpdate = vi.fn(async () => ({ data: { id: 'proc-id' } }))

vi.mock('@/hooks/mutations/use-procedure-mutations', () => ({
  useExecuteProcedure: () => ({ mutateAsync: mockExecute, isPending: false }),
  useUpdateProcedure: () => ({ mutateAsync: mockUpdate, isPending: false }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function installFetchMock() {
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('ProcedureExecution — characterization', () => {
  beforeEach(() => {
    mockExecute.mockClear()
    installFetchMock()
  })

  it('fires useExecuteProcedure with the procedure id and clinical fields when triggerSave increments', async () => {
    const fixtureProcedure = {
      id: 'proc-id',
      procedureTypeId: 'proc-type-id',
      status: 'approved',
      technique: 'Técnica prévia',
      clinicalResponse: 'Resposta prévia',
      adverseEffects: '',
      notes: '',
      followUpDate: '',
      nextSessionObjectives: '',
      plannedSnapshot: null,
    } as never

    const baseOverrides = {
      hideSaveButton: true,
      hideNavigation: true,
      hideTitle: true,
      onSaveComplete: vi.fn(),
    }

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <ProcedureExecution
          patientId="patient-id"
          patientGender="female"
          procedure={fixtureProcedure}
          diagrams={[]}
          existingApplications={[]}
          wizardOverrides={{ ...baseOverrides, triggerSave: 0 }}
        />
      </QueryClientProvider>,
    )

    rerender(
      <QueryClientProvider client={qc}>
        <ProcedureExecution
          patientId="patient-id"
          patientGender="female"
          procedure={fixtureProcedure}
          diagrams={[]}
          existingApplications={[]}
          wizardOverrides={{ ...baseOverrides, triggerSave: 1 }}
        />
      </QueryClientProvider>,
    )

    await vi.waitFor(() => expect(mockExecute).toHaveBeenCalled(), { timeout: 3000 })

    const firstCall = mockExecute.mock.calls[0] as unknown as [Record<string, unknown>] | undefined
    const payload = firstCall?.[0] ?? ({} as Record<string, unknown>)
    expect(payload).toMatchObject({
      id: 'proc-id',
      technique: 'Técnica prévia',
      clinicalResponse: 'Resposta prévia',
    })
    // Confirm the payload does NOT have performedAt
    expect(payload).not.toHaveProperty('performedAt')
  })
})
