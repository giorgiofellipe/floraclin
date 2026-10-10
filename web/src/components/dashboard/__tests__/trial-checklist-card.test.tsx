import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TrialChecklistCard } from '../trial-checklist-card'
import type { ActivationState } from '@/lib/activation'

function activationWith(overrides: Partial<ActivationState> = {}): ActivationState {
  return {
    onboardingDone: false,
    hasPatient: false,
    hasAppointment: false,
    hasProcedureRecord: false,
    hasWhatsappSend: false,
    trialDay: 2,
    daysLeft: 12,
    subscriptionStatus: 'trialing',
    subscriptionSource: 'trial',
    optedOut: false,
    ...overrides,
  }
}

describe('TrialChecklistCard', () => {
  it('counts done steps, drops the link on done rows and keeps it on open rows', () => {
    render(
      <TrialChecklistCard activation={activationWith({ onboardingDone: true, hasPatient: true })} />,
    )

    expect(screen.getByText('2 de 5')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Cadastrar o primeiro paciente' })).toBeNull()
    expect(screen.getByText('Cadastrar o primeiro paciente')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Agendar o primeiro atendimento' })).toHaveAttribute(
      'href',
      '/agenda?open=new',
    )
  })

  it('renders nothing when all five steps are done, so a finished clinic keeps no stale nag', () => {
    const { container } = render(
      <TrialChecklistCard
        activation={activationWith({
          onboardingDone: true,
          hasPatient: true,
          hasAppointment: true,
          hasProcedureRecord: true,
          hasWhatsappSend: true,
        })}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for an active subscription, so paying clinics see no trial UI', () => {
    const { container } = render(
      <TrialChecklistCard activation={activationWith({ subscriptionStatus: 'active' })} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing without activation data', () => {
    const { container } = render(<TrialChecklistCard activation={null} />)

    expect(container).toBeEmptyDOMElement()
  })
})
