import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProspectCard } from '../prospect-card'
import type { Prospect } from '../types'

const baseProspect: Prospect = {
  id: 'prospect-1',
  tenantId: 'tenant-1',
  name: 'Maria Silva',
  phone: '11999998888',
  source: 'whatsapp',
  stage: 'novo',
  intent: null,
  interestedProcedures: [],
  sentiment: null,
  value: null,
  notes: null,
  assignedUserId: null,
  assignedUserName: null,
  whatsappConversationId: null,
  convertedPatientId: null,
  lostReason: null,
  createdAt: '2026-08-28T12:00:00Z',
  updatedAt: '2026-08-28T12:00:00Z',
  attribution: null,
}

describe('<ProspectCard>', () => {
  it('renders the ad headline when attribution has one', () => {
    render(
      <ProspectCard
        prospect={{
          ...baseProspect,
          attribution: { adHeadline: 'Preenchimento labial com 20% off', channel: 'ctwa' },
        }}
        onClick={vi.fn()}
      />,
    )
    expect(screen.getByText('Preenchimento labial com 20% off')).toBeInTheDocument()
  })

  it('renders a channel label when attribution has no headline', () => {
    render(
      <ProspectCard
        prospect={{
          ...baseProspect,
          attribution: { adHeadline: null, channel: 'booking_page' },
        }}
        onClick={vi.fn()}
      />,
    )
    expect(screen.getByText('Página de agendamento')).toBeInTheDocument()
  })

  it('renders neither line when there is no attribution', () => {
    render(<ProspectCard prospect={baseProspect} onClick={vi.fn()} />)
    expect(screen.queryByText('Orgânico')).not.toBeInTheDocument()
    expect(screen.queryByText('Manual')).not.toBeInTheDocument()
    expect(screen.queryByText('Anúncio WhatsApp')).not.toBeInTheDocument()
    expect(screen.queryByText('Página de agendamento')).not.toBeInTheDocument()
  })
})
