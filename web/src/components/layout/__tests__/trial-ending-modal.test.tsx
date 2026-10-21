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

const REFERRAL = {
  kind: 'referral' as const,
  referrerName: 'Clínica Bela',
  label: '20% de desconto nos 2 primeiros meses',
  percentOff: 20,
  amountOffCents: null,
  duration: 'repeating' as const,
  durationInMonths: 2,
  planSlugs: ['starter', 'pro'],
}

const PLANS = [
  { slug: 'starter', name: 'Starter', priceCents: 9900, billingInterval: 'month', benefits: ['A'], recommended: false },
  { slug: 'pro', name: 'Pro', priceCents: 19900, billingInterval: 'month', benefits: ['B'], recommended: true },
]

function renderModal(trialEndsAt: string | null, readOnly = false, referral: typeof REFERRAL | null = null) {
  return render(
    <SubscriptionAccessProvider
      readOnly={readOnly}
      reason={null}
      tenantId="t1"
      canSubscribe
      plans={PLANS}
      winback={null}
      referral={referral}
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
    // Starter first, Pro right after it and highlighted.
    const cards = screen.getAllByTestId(/^paywall-plan-(starter|pro)$/)
    expect(cards.map((c) => c.dataset.testid)).toEqual(['paywall-plan-starter', 'paywall-plan-pro'])
  })

  it('shows the referral badge and the discounted price when there is an offer', async () => {
    renderModal(TOMORROW_1830, false, REFERRAL)

    const modal = await screen.findByTestId('trial-ending-modal')
    expect(screen.getByTestId('referral-offer')).toHaveTextContent('Indicação de Clínica Bela: 20% de desconto nos 2 primeiros meses.')
    expect(screen.getByTestId('paywall-plan-starter')).toHaveTextContent(/R\$\s?79,20/)
    expect(modal.querySelector('s')).toHaveTextContent(/R\$\s?99,00/)
  })

  it('has no badge and full prices without an offer', async () => {
    renderModal(TOMORROW_1830)

    await screen.findByTestId('trial-ending-modal')
    expect(screen.queryByTestId('referral-offer')).not.toBeInTheDocument()
    expect(screen.getByTestId('paywall-plan-starter')).toHaveTextContent(/R\$\s?99,00/)
    expect(screen.getByTestId('paywall-plan-starter').querySelector('s')).toBeNull()
  })

  it('shows once: dismissing it keeps it closed on the next load', async () => {
    const { unmount } = renderModal(TOMORROW_1830)
    fireEvent.click(await screen.findByTestId('trial-ending-later'))
    await waitFor(() => expect(screen.queryByTestId('trial-ending-modal')).not.toBeInTheDocument())
    expect(window.localStorage.getItem(trialEndingModalKey('t1', TOMORROW_1830))).not.toBeNull()
    unmount()

    renderModal(TOMORROW_1830)
    expect(screen.queryByTestId('trial-ending-modal')).not.toBeInTheDocument()
  })

  it('shows again when an admin extension moves the trial end', async () => {
    const { unmount } = renderModal(TOMORROW_1830)
    fireEvent.click(await screen.findByTestId('trial-ending-later'))
    await waitFor(() => expect(screen.queryByTestId('trial-ending-modal')).not.toBeInTheDocument())
    unmount()

    renderModal('2026-10-22T23:00:00.000Z')
    expect(await screen.findByTestId('trial-ending-modal')).toBeInTheDocument()
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
