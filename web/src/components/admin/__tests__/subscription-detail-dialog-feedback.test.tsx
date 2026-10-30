import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders as render } from '@/tests/test-utils'
import { SubscriptionDetailDialog } from '../subscription-detail-dialog'

// The feedback reward toggle: says whether it is set, by whom and when, and
// only offers to set it where checkout would honour it.

const setFeedback = vi.fn()
const detail = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))

vi.mock('@/hooks/queries/use-admin-subscriptions', () => ({
  useAdminSubscriptionDetail: () => ({ data: { data: detail.value } }),
  useAdminPlans: () => ({ data: { data: [] } }),
}))
vi.mock('@/hooks/mutations/use-admin-subscription-mutations', () => ({
  useUpdateSubscription: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGiftSubscription: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExtendTrial: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetFeedbackDiscount: () => ({ mutateAsync: setFeedback, isPending: false }),
}))
vi.mock('../tenant-referrals-panel', () => ({ TenantReferralsPanel: () => null }))

const TRIAL = {
  id: 's1',
  tenantId: 't1',
  planId: 'p1',
  status: 'trialing',
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  currentPeriodStart: '2099-02-10T02:00:00.000Z',
  currentPeriodEnd: '2099-03-10T02:00:00.000Z',
  canceledAt: null,
  source: 'trial',
  giftedBy: null,
  giftedMonths: null,
  notes: null,
  tenantName: 'Clínica Teste',
  tenantSlug: 'clinica-teste',
  planSlug: 'trial',
  planName: 'Teste',
}

beforeEach(() => {
  vi.clearAllMocks()
  setFeedback.mockResolvedValue({})
})

describe('SubscriptionDetailDialog feedback discount', () => {
  it('offers to apply it on a trial and sends granted: true', async () => {
    detail.value = { ...TRIAL, firstPaidAt: null, feedbackDiscount: null }
    render(<SubscriptionDetailDialog open onOpenChange={() => {}} subscription={TRIAL} />)
    expect(screen.getByText('Desconto feedback (50% por 3 meses)')).toBeInTheDocument()
    expect(screen.getByTestId('admin-feedback-discount-status')).toHaveTextContent('Não aplicado')
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar desconto' }))
    await waitFor(() => expect(setFeedback).toHaveBeenCalledWith({ tenantId: 't1', granted: true }))
  })

  it('says who applied it and when, and removes it with granted: false', async () => {
    detail.value = {
      ...TRIAL,
      feedbackDiscount: { grantedAt: '2026-10-29T15:00:00.000Z', grantedBy: 'u1', grantedByName: 'Admin Zero' },
    }
    render(<SubscriptionDetailDialog open onOpenChange={() => {}} subscription={TRIAL} />)
    // 12:00 in São Paulo.
    expect(screen.getByTestId('admin-feedback-discount-status')).toHaveTextContent(
      'Ativo: aplicado por Admin Zero em 29/10/2026 às 12:00.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remover desconto' }))
    await waitFor(() => expect(setFeedback).toHaveBeenCalledWith({ tenantId: 't1', granted: false }))
  })

  it('explains, without a button, why a Stripe-billed clinic cannot get it', () => {
    const stripe = { ...TRIAL, status: 'active', source: 'stripe', stripeSubscriptionId: 'sub_1' }
    detail.value = { ...stripe, feedbackDiscount: null }
    render(<SubscriptionDetailDialog open onOpenChange={() => {}} subscription={stripe} />)
    expect(screen.getByTestId('admin-feedback-discount-status')).toHaveTextContent(/assinatura paga no Stripe/)
    expect(screen.queryByTestId('admin-feedback-discount-toggle')).not.toBeInTheDocument()
  })
})
