import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/hooks/mutations/use-consent-mutations', () => ({
  useAcceptConsent: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('../approval/send-consent-signing-link', () => ({ SendConsentSigningLink: () => null }))
vi.mock('../approval/service-contract-section', () => ({ ServiceContractSection: () => null }))
vi.mock('../approval/consent-status-list', () => ({ ConsentStatusList: () => null }))

import { ProcedureApproval } from '../procedure-approval'

const procedure = {
  id: 'rec-1',
  procedureTypeId: 'type-1',
  procedureTypeName: 'Botox',
  practitionerId: 'prac-1',
  financialPlan: { totalAmount: 800, installmentCount: 1, paymentMethod: 'pix' },
} as never

const fetchMock = vi.fn()

function mockFetch(generalSigned: boolean) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/finalize')) {
      return new Response(
        JSON.stringify({
          success: true,
          data: { encounterId: 'enc-1', patientPackageId: null, procedureRecordIds: ['rec-1'], financialEntryId: 'fe-1' },
        }),
        { status: 200 },
      )
    }
    if (url.includes('/api/procedure-types')) return new Response('[]', { status: 200 })
    if (url.includes('/api/consent/history')) {
      const signed = generalSigned && url.includes('type=general')
      return new Response(JSON.stringify({ data: signed ? { id: 'signed' } : null }), { status: 200 })
    }
    return new Response('null', { status: 200 })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = fetchMock as unknown as typeof fetch
})

function renderApproval(onPending: (labels: string[]) => void) {
  render(
    <ProcedureApproval
      procedure={procedure}
      patient={{ id: 'pat-1', fullName: 'Ana' }}
      tenant={{ id: 't-1', name: 'Clínica' }}
      onPendingSignaturesChange={onPending}
    />,
  )
}

describe('ProcedureApproval with unsigned terms', () => {
  it('lets the clinic approve and sign later', async () => {
    mockFetch(false)
    const onPending = vi.fn()
    renderApproval(onPending)

    const approve = await screen.findByRole('button', { name: 'Aprovar e assinar depois' })
    expect(approve).toBeEnabled()
    expect(screen.getByText(/coletar as assinaturas agora ou depois/)).toBeInTheDocument()
    expect(onPending).toHaveBeenLastCalledWith(['Consentimento Geral'])

    fireEvent.click(approve)
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/finalize'))).toBe(true),
    )
  })

  it('keeps the plain label and no note when everything is signed', async () => {
    mockFetch(true)
    const onPending = vi.fn()
    renderApproval(onPending)

    await screen.findByRole('button', { name: /Aprovar Procedimento/ })
    await waitFor(() => expect(onPending).toHaveBeenCalledWith([]))
    expect(screen.queryByText(/coletar as assinaturas agora ou depois/)).not.toBeInTheDocument()
  })
})
