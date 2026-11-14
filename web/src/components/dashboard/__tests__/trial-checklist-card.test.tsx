import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
    msLeft: 12 * 24 * 60 * 60 * 1000,
    subscriptionStatus: 'trialing',
    subscriptionSource: 'trial',
    optedOut: false,
    lastMarketingSentAt: null,
    ...overrides,
  }
}

const allStepsDone = activationWith({
  onboardingDone: true,
  hasPatient: true,
  hasAppointment: true,
  hasProcedureRecord: true,
  hasWhatsappSend: true,
})

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

  it('marks only the first open step as the next one', () => {
    render(<TrialChecklistCard activation={activationWith({ onboardingDone: true, hasPatient: true })} />)

    const next = screen.getByRole('link', { name: 'Agendar o primeiro atendimento' })
    expect(next).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('link', { name: /Registrar o primeiro procedimento/ })).not.toHaveAttribute('aria-current')
  })

  // Regression: this step linked to the patient list, two taps away from the atendimento.
  it.each([
    ['p-9', '/pacientes/p-9/atendimento?new=1'],
    [null, '/pacientes?novo=1'],
  ])('sends the procedure step to the newest patient\'s atendimento (latest patient %s)', (latestPatientId, href) => {
    render(<TrialChecklistCard activation={activationWith({ onboardingDone: true })} latestPatientId={latestPatientId} />)

    expect(screen.getByRole('link', { name: /Registrar o primeiro procedimento/ })).toHaveAttribute('href', href)
  })

  it.each([
    ['import help is not offered', {}],
    ['import help was already requested', { canRequestImport: true, importHelpRequested: true }],
  ])('renders nothing when all five steps are done and %s, so a finished clinic keeps no stale nag', (_case, props) => {
    const { container } = render(<TrialChecklistCard activation={allStepsDone} {...props} />)

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

  describe('import help', () => {
    afterEach(() => vi.unstubAllGlobals())

    function renderWithQuery(ui: React.ReactElement) {
      return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)
    }

    it('asks for help once tapped and shows it as done, without counting it as a step', async () => {
      const fetchMock = vi.fn(async () => Response.json({ requestedAt: '2026-11-03T12:00:00.000Z' }))
      vi.stubGlobal('fetch', fetchMock)
      renderWithQuery(
        <TrialChecklistCard activation={activationWith({ onboardingDone: true, hasPatient: true })} canRequestImport />,
      )

      await userEvent.click(screen.getByRole('button', { name: 'Quero ajuda' }))

      expect(await screen.findByText('A gente entra em contato pelo WhatsApp para receber seus arquivos.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Quero ajuda' })).toBeNull()
      expect(fetchMock).toHaveBeenCalledWith('/api/onboarding/import-request', expect.objectContaining({ method: 'POST' }))
      expect(screen.getByText('2 de 5')).toBeInTheDocument()
    })

    it('still offers import help once all five steps are done', () => {
      renderWithQuery(<TrialChecklistCard activation={allStepsDone} canRequestImport />)

      expect(screen.getByRole('button', { name: 'Quero ajuda' })).toBeInTheDocument()
    })

    it('shows an earlier request as done on load', () => {
      renderWithQuery(<TrialChecklistCard activation={activationWith()} canRequestImport importHelpRequested />)

      expect(screen.getByText('A gente entra em contato pelo WhatsApp para receber seus arquivos.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Quero ajuda' })).toBeNull()
    })
  })
})
