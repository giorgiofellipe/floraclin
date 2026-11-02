import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders as render } from '@/tests/test-utils'
import { SubscriptionDetailDialog } from '../subscription-detail-dialog'

/**
 * A clinic billed through Stripe is changed through Stripe: the dialog says
 * so up front instead of offering a button the API then refuses.
 */

const mutateAsync = vi.fn()
const detail = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))

vi.mock('@/hooks/queries/use-admin-subscriptions', () => ({
  useAdminSubscriptionDetail: () => ({ data: { data: detail.value } }),
  useAdminPlans: () => ({ data: { data: [] } }),
}))
vi.mock('@/hooks/mutations/use-admin-subscription-mutations', () => ({
  useUpdateSubscription: () => ({ mutateAsync, isPending: false }),
  useGiftSubscription: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExtendTrial: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetFeedbackDiscount: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('../tenant-referrals-panel', () => ({ TenantReferralsPanel: () => null }))

const FUTURE = '2099-03-10T02:00:00.000Z'

function sub(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    tenantId: 't1',
    planId: 'p1',
    status: 'active',
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
    currentPeriodStart: '2099-02-10T02:00:00.000Z',
    currentPeriodEnd: FUTURE,
    canceledAt: null,
    source: 'stripe',
    giftedBy: null,
    giftedMonths: null,
    notes: null,
    tenantName: 'Clínica Viva',
    tenantSlug: 'clinica-viva',
    planSlug: 'starter',
    planName: 'Starter',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  detail.value = {}
})

describe('SubscriptionDetailDialog on a Stripe subscription', () => {
  it('points "Cancelar" to Stripe instead of cancelling locally', () => {
    render(<SubscriptionDetailDialog open onOpenChange={() => {}} subscription={sub()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByTestId('admin-stripe-cancel').textContent).toMatch(/painel do Stripe ou pelo portal de cobrança/)
    expect(screen.queryByRole('button', { name: 'Cancelar assinatura' })).toBeNull()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('explains a pending cancellation (BR date) instead of offering a reactivation', () => {
    detail.value = { stripeState: 'pending_cancel' }
    render(<SubscriptionDetailDialog open onOpenChange={() => {}} subscription={sub({ status: 'canceled' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reativar' }))
    expect(screen.getByTestId('admin-stripe-reactivation-blocked').textContent).toContain('acesso pago até 09/03/2099')
    expect(screen.queryByTestId('admin-new-period-end')).toBeNull()
  })

  it('offers the reactivation as a grant when Stripe already ended the subscription', () => {
    detail.value = { stripeState: 'ended' }
    render(<SubscriptionDetailDialog open onOpenChange={() => {}} subscription={sub({ status: 'canceled' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reativar' }))
    expect(screen.queryByTestId('admin-stripe-reactivation-blocked')).toBeNull()
    expect(screen.getByTestId('admin-new-period-end')).toBeTruthy()
  })

  it('says the subscription is still active at Stripe when it is billing again', () => {
    detail.value = { stripeState: 'live' }
    render(<SubscriptionDetailDialog open onOpenChange={() => {}} subscription={sub({ status: 'canceled' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reativar' }))
    expect(screen.getByTestId('admin-stripe-reactivation-blocked').textContent).toMatch(/ainda está ativa no Stripe/)
  })

  it('explains why a gift is not possible while Stripe still bills the clinic', () => {
    detail.value = { stripeState: 'live' }
    render(<SubscriptionDetailDialog open onOpenChange={() => {}} subscription={sub()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Presentear' }))
    expect(screen.getByTestId('admin-stripe-gift').textContent).toMatch(/assinatura ativa no Stripe/)
    expect(screen.queryByPlaceholderText('Motivo do presente...')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Presentear' })).toBeNull()
  })

  it('offers the gift form once Stripe says the subscription ended', () => {
    detail.value = { stripeState: 'ended' }
    render(<SubscriptionDetailDialog open onOpenChange={() => {}} subscription={sub({ status: 'canceled' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Presentear' }))
    expect(screen.queryByTestId('admin-stripe-gift')).toBeNull()
    expect(screen.getByPlaceholderText('Motivo do presente...')).toBeTruthy()
  })

  it('does not offer "Estender teste" on a Stripe trial', () => {
    render(<SubscriptionDetailDialog open onOpenChange={() => {}} subscription={sub({ status: 'trialing' })} />)
    expect(screen.queryByRole('button', { name: 'Estender teste' })).toBeNull()
  })

  it('gives the end date when the Stripe subscription is already set to cancel', () => {
    detail.value = { stripeState: 'pending_cancel' }
    render(<SubscriptionDetailDialog open onOpenChange={() => {}} subscription={sub({ status: 'canceled' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Presentear' }))
    expect(screen.getByTestId('admin-stripe-gift').textContent).toContain('termina em 09/03/2099')
  })
})
