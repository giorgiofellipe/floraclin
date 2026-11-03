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

    it('shows why a request failed and lets the owner ask again', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ error: 'Não foi possível enviar agora. Tente de novo.' }, { status: 502 }))
        .mockResolvedValueOnce(Response.json({ requestedAt: '2026-11-03T12:00:00.000Z' }))
      vi.stubGlobal('fetch', fetchMock)
      renderWithQuery(<TrialChecklistCard activation={activationWith()} canRequestImport />)

      await userEvent.click(screen.getByRole('button', { name: 'Quero ajuda' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível enviar agora. Tente de novo.')

      await userEvent.click(screen.getByRole('button', { name: 'Quero ajuda' }))

      expect(await screen.findByText('A gente entra em contato pelo WhatsApp para receber seus arquivos.')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('hides the import row from anyone who is not the clinic owner', () => {
      render(<TrialChecklistCard activation={activationWith()} canRequestImport={false} />)

      expect(screen.queryByText('Importar pacientes de outro sistema')).toBeNull()
    })

    it('shows an earlier request as done on load', () => {
      renderWithQuery(<TrialChecklistCard activation={activationWith()} canRequestImport importHelpRequested />)

      expect(screen.getByText('A gente entra em contato pelo WhatsApp para receber seus arquivos.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Quero ajuda' })).toBeNull()
    })
  })
})
