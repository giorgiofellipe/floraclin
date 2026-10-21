import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const pathnameMock = vi.hoisted(() => vi.fn(() => '/dashboard'))
vi.mock('next/navigation', () => ({
  usePathname: pathnameMock,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

import { TrialEndingModal, trialEndingModalKey, trialEndingTitle } from '../trial-ending-modal'
import { SubscriptionAccessProvider } from '../subscription-access'

// 09:00 BRT on 21/10.
const NOW = new Date('2026-10-21T12:00:00.000Z')
const TOMORROW_1830 = '2026-10-22T21:30:00.000Z'

const PLANS = [
  { slug: 'starter', name: 'Starter', priceCents: 9900, billingInterval: 'month', benefits: ['A'], recommended: false },
  { slug: 'pro', name: 'Pro', priceCents: 19900, billingInterval: 'month', benefits: ['B'], recommended: true },
]

function renderModal(trialEndsAt: string | null, readOnly = false) {
  return render(
    <SubscriptionAccessProvider
      readOnly={readOnly}
      reason={null}
      tenantId="t1"
      canSubscribe
      plans={PLANS}
      winback={null}
      recap={{ patients: 8, appointments: 15, procedureRecords: 0, photos: 3, diagrams: 0 }}
      trialEndsAt={trialEndsAt}
    >
      <TrialEndingModal />
    </SubscriptionAccessProvider>,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  window.localStorage.clear()
  pathnameMock.mockReturnValue('/dashboard')
})
afterEach(() => {
  vi.useRealTimers()
})

describe('TrialEndingModal', () => {
  it('says when the trial ends, with the clinic numbers and the plans', async () => {
    renderModal(TOMORROW_1830)

    const modal = await screen.findByTestId('trial-ending-modal')
    expect(screen.getByRole('heading', { name: 'Seu teste termina amanhã às 18:30' })).toBeInTheDocument()
    expect(screen.getByTestId('trial-recap')).toHaveTextContent(/8\s*pacientes/)
    expect(screen.getByTestId('trial-recap')).toHaveTextContent(/3\s*fotos/)
    expect(screen.getByTestId('trial-recap')).not.toHaveTextContent('atendimento')
    expect(modal).toHaveTextContent('Continuar com o Pro')
  })

  it('shows once: dismissing it keeps it closed on the next load', async () => {
    const { unmount } = renderModal(TOMORROW_1830)
    fireEvent.click(await screen.findByTestId('trial-ending-later'))
    await waitFor(() => expect(screen.queryByTestId('trial-ending-modal')).not.toBeInTheDocument())
    expect(window.localStorage.getItem(trialEndingModalKey('t1'))).not.toBeNull()
    unmount()

    renderModal(TOMORROW_1830)
    expect(screen.queryByTestId('trial-ending-modal')).not.toBeInTheDocument()
  })

  it('renders nothing without a trial ending within a day', () => {
    renderModal(null)
    expect(screen.queryByTestId('trial-ending-modal')).not.toBeInTheDocument()
  })

  it('gives way to the paywall once the clinic is read-only', () => {
    renderModal(TOMORROW_1830, true)
    expect(screen.queryByTestId('trial-ending-modal')).not.toBeInTheDocument()
  })

  it('does not open on the billing page', () => {
    pathnameMock.mockReturnValue('/configuracoes')
    renderModal(TOMORROW_1830)
    expect(screen.queryByTestId('trial-ending-modal')).not.toBeInTheDocument()
  })

  it('titles the last day "hoje às"', () => {
    expect(trialEndingTitle(new Date('2026-10-21T21:30:00.000Z'), NOW)).toBe('Seu teste termina hoje às 18:30')
  })
})
