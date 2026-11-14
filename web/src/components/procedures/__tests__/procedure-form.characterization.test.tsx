import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProcedureForm } from '../procedure-form'

// Mocks MUST be declared at module level so vi.mock hoists them
const mockCreate = vi.fn(async () => ({ data: { id: 'created-proc-id' } }))
const mockUpdate = vi.fn(async () => ({ data: { id: 'updated-proc-id' } }))
const mockSaveEval = vi.fn(async () => ({ id: 'eval-resp-id' }))

vi.mock('@/hooks/mutations/use-procedure-mutations', () => ({
  useCreateProcedure: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateProcedure: () => ({ mutateAsync: mockUpdate, isPending: false }),
}))

vi.mock('@/hooks/mutations/use-evaluation-mutations', () => ({
  useSaveEvaluationResponse: () => ({ mutateAsync: mockSaveEval, isPending: false }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function installFetchMock() {
  global.fetch = vi.fn(async (_input: RequestInfo | URL) => {
    // Default: empty array; the form handles empty type/product/consent lists gracefully
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

describe('ProcedureForm — characterization (planning mode)', () => {
  beforeEach(() => {
    mockCreate.mockClear()
    mockUpdate.mockClear()
    mockSaveEval.mockClear()
    installFetchMock()
  })

  async function savePlanning(extra: { appointmentId?: string } = {}): Promise<Record<string, unknown>> {
    const baseOverrides = {
      hideSaveButton: true,
      hideNavigation: true,
      hideTitle: true,
      hideProcedureTypes: true,
      onSaveComplete: vi.fn(),
    }
    // One QueryClient across both renders so the component doesn't unmount on rerender.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const form = (triggerSave: number) => (
      <QueryClientProvider client={qc}>
        <ProcedureForm
          patientId="patient-123"
          patientGender="female"
          initialTypeIds={['550e8400-e29b-41d4-a716-446655440000']}
          mode="create"
          wizardOverrides={{ ...baseOverrides, triggerSave }}
          {...extra}
        />
      </QueryClientProvider>
    )
    const { rerender } = render(form(0))
    // Flipping triggerSave fires the save path.
    rerender(form(1))
    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalled(), { timeout: 3000 })
    const firstCall = mockCreate.mock.calls[0] as unknown as [Record<string, unknown>] | undefined
    return firstCall?.[0] ?? {}
  }

  it('fires useCreateProcedure with planning-mode payload when triggerSave increments', async () => {
    const payload = await savePlanning()
    expect(payload).toMatchObject({
      patientId: 'patient-123',
      procedureTypeId: '550e8400-e29b-41d4-a716-446655440000',
    })
    // Execution-phase fields are owned by procedure-execution.tsx and must
    // never appear in the planning payload.
    expect(payload).not.toHaveProperty('technique')
    expect(payload).not.toHaveProperty('clinicalResponse')
    expect(payload).not.toHaveProperty('adverseEffects')
    expect(payload).not.toHaveProperty('notes')
    expect(payload).not.toHaveProperty('followUpDate')
    expect(payload).not.toHaveProperty('nextSessionObjectives')
    expect(payload).not.toHaveProperty('appointmentId')
  })

  // The Painel counts a charge made in the atendimento only through this link.
  it('links the new procedure to the appointment the atendimento was opened from', async () => {
    const payload = await savePlanning({ appointmentId: 'appt-1' })
    expect(payload).toMatchObject({ appointmentId: 'appt-1' })
  })
})
