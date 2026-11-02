import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/tests/test-utils'
import type { PendingConsentItem } from '@/db/queries/consent'

let items: PendingConsentItem[] = []
vi.mock('@/hooks/queries/use-consent', () => ({
  usePendingConsents: () => ({ data: items }),
}))

import { PendingConsentsList } from '../pending-consents-list'

describe('PendingConsentsList', () => {
  it('shows chips, BR approval date and the sign link for a pending item', () => {
    items = [
      {
        procedureRecordId: 'rec-1',
        procedureTypeName: 'Botox',
        // 01:00 UTC is still the previous day in Brazil
        approvedAt: '2026-11-03T01:00:00.000Z' as unknown as Date,
        pendingTypes: ['general', 'service_contract'],
      },
    ]
    renderWithProviders(<PendingConsentsList patientId="pat-1" />)

    expect(screen.getByText('Consentimento Geral')).toBeTruthy()
    expect(screen.getByText('Contrato de Serviço')).toBeTruthy()
    expect(screen.getByText(/02\/11\/2026/)).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Coletar assinaturas' }).getAttribute('href'),
    ).toBe('/pacientes/pat-1/procedimentos/rec-1?action=sign')
  })

  it('renders nothing when there are no pending items', () => {
    items = []
    const { container } = renderWithProviders(<PendingConsentsList patientId="pat-1" />)
    expect(container.innerHTML).toBe('')
  })
})
