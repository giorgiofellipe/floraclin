import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TenantLifecycleSection } from '../tenant-lifecycle-section'

describe('TenantLifecycleSection', () => {
  it('shows a failed send with its error and a captured reply with its body', () => {
    render(
      <TenantLifecycleSection
        lifecycle={{
          sends: [
            {
              messageKey: 'trial_welcome',
              channel: 'whatsapp',
              status: 'failed',
              claimedAt: '2026-10-09T15:30:00.000Z',
              error: 'Numero invalido',
            },
          ],
          replies: [
            {
              messageKey: 'trial_first_patient',
              body: 'Quero ajuda para começar',
              receivedAt: '2026-10-09T16:00:00.000Z',
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('trial_welcome')).toBeInTheDocument()
    expect(screen.getByText('falhou')).toBeInTheDocument()
    expect(screen.getByText('WhatsApp')).toBeInTheDocument()
    expect(screen.getByText('09/10 12:30')).toBeInTheDocument()
    expect(screen.getByText('Numero invalido')).toBeInTheDocument()
    expect(screen.getByText('trial_first_patient')).toBeInTheDocument()
    expect(screen.getByText('Quero ajuda para começar')).toBeInTheDocument()
  })

  it('renders nothing when there is no history', () => {
    const { container } = render(<TenantLifecycleSection lifecycle={{ sends: [], replies: [] }} />)

    expect(container).toBeEmptyDOMElement()
  })
})
