import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/hooks/mutations/use-consent-mutations', () => ({
  useAcceptConsent: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@/components/financial/card-payment-fields', () => ({
  CardPaymentFields: ({ onChange, value }: { onChange: (v: unknown) => void; value: object }) => (
    <button type="button" onClick={() => onChange({ ...value, terminalId: 'term-1', expectedRate: 8.99 })}>
      escolher maquininha
    </button>
  ),
}))
vi.mock('@/components/service-wizard/wizard-cart', () => ({ WizardCart: () => null }))
vi.mock('../approval/send-consent-signing-link', () => ({ SendConsentSigningLink: () => null }))
vi.mock('../approval/service-contract-section', () => ({ ServiceContractSection: () => null }))
vi.mock('../approval/consent-status-list', () => ({ ConsentStatusList: () => null }))

import { ProcedureApproval } from '../procedure-approval'

const cart = {
  templateId: null,
  templateName: null,
  templateDefaultPrice: null,
  templateValidityMonths: null,
  lines: [
    {
      procedureTypeId: 'type-1',
      procedureTypeName: 'Botox',
      sessions: 1,
      defaultPrice: 800,
      sourceTemplateLineId: null,
    },
  ],
  totalOverride: null,
}

const procedure = {
  id: 'rec-1',
  procedureTypeId: 'type-1',
  procedureTypeName: 'Botox',
  practitionerId: 'prac-1',
  financialPlan: { totalAmount: 800, installmentCount: 6, paymentMethod: 'credit_card' },
} as never

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = fetchMock as unknown as typeof fetch
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
      return new Response(JSON.stringify({ data: { id: 'signed' } }), { status: 200 })
    }
    return new Response('null', { status: 200 })
  })
})

async function renderApproval() {
  render(
    <ProcedureApproval
      procedure={procedure}
      cart={cart}
      draftRecordIds={['rec-1']}
      encounterId="enc-1"
      patient={{ id: 'pat-1', fullName: 'Ana' }}
      tenant={{ id: 't-1', name: 'Clínica' }}
    />,
  )
  const approve = await screen.findByRole('button', { name: /Aprovar Procedimento/ })
  await waitFor(() => expect(approve).toBeEnabled())
  return approve
}

function finalizeBody() {
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/finalize'))
  return JSON.parse(call![1].body as string)
}

describe('ProcedureApproval card payment', () => {
  it('does not send cardPayment when the checkbox is left unchecked', async () => {
    const approve = await renderApproval()
    fireEvent.click(approve)

    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/finalize'))).toBe(true))
    expect(finalizeBody().cardPayment).toBeUndefined()
  })

  it('sends the chosen terminal as cardPayment when the checkbox is checked', async () => {
    const approve = await renderApproval()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('escolher maquininha'))
    fireEvent.click(approve)

    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/finalize'))).toBe(true))
    expect(finalizeBody().cardPayment).toEqual({ terminalId: 'term-1', expectedRate: 8.99 })
  })
})
