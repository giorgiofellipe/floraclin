import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `customer.subscription.updated` only ever looked at the price.
 *
 * Anything that changed a subscription without changing its plan (a
 * cancellation, a reactivation, a payment recovering, Stripe giving up
 * retrying) reached this handler and did nothing, so the local row matched
 * Stripe only when one of our own routes had written it. That was survivable
 * while those routes were the only surface, and stopped being so the moment
 * the billing portal existed, because a customer can cancel from there.
 */

const updateSubscriptionStatusMock = vi.fn()
const updateSubscriptionPeriodCalls = () => updateSubscriptionPeriodMock.mock.calls
const updateSubscriptionPlanMock = vi.fn()
const updateSubscriptionPeriodMock = vi.fn()
const constructWebhookEventMock = vi.fn()
const retrieveSubscriptionMock = vi.fn()
const selectMock = vi.fn()

// `subscriptionPeriod` stays real: it is pure, and mocking it would hide the
// exact shape the route depends on, which is the whole point here.
vi.mock('@/lib/stripe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stripe')>()),
  constructWebhookEvent: (...a: unknown[]) => constructWebhookEventMock(...a),
  retrieveSubscription: (...a: unknown[]) => retrieveSubscriptionMock(...a),
}))
vi.mock('@/db/queries/subscriptions', () => ({
  getPlanBySlug: vi.fn(),
  updateSubscriptionPlan: (...a: unknown[]) => updateSubscriptionPlanMock(...a),
  updateSubscriptionPeriod: (...a: unknown[]) => updateSubscriptionPeriodMock(...a),
  updateSubscriptionStatus: (...a: unknown[]) => updateSubscriptionStatusMock(...a),
}))
vi.mock('@/db/client', () => ({ db: { select: () => selectMock() } }))
vi.mock('@/db/schema', () => ({ tenantSubscriptions: {}, plans: {} }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))
vi.mock('@/lib/api-error', () => ({
  handleApiError: () => new Response('error', { status: 500 }),
}))

import { POST } from '../route'

const EXISTING_ROW = {
  tenantId: 'tenant-1',
  planId: 'plan-starter',
  status: 'active',
  canceledAt: null,
  source: 'stripe',
}

/** Stands in for `select().from().where().limit()`. */
function rows(result: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(result),
  }
  return chain
}

function stripeSubscription(over: Record<string, unknown>) {
  return {
    id: 'sub_1',
    status: 'active',
    cancel_at_period_end: false,
    items: {
      data: [
        {
          price: { id: 'price_starter' },
          current_period_start: new Date('2026-09-01T00:00:00.000Z').getTime() / 1000,
          current_period_end: new Date('2026-10-01T00:00:00.000Z').getTime() / 1000,
        },
      ],
    },
    ...over,
  }
}

function post() {
  const req = new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    body: '{}',
    headers: { 'stripe-signature': 'sig' },
  })
  return POST(req as never)
}

/**
 * Delivers an event. `current` defaults to the same thing the event carried,
 * which is the ordinary case; pass it explicitly to model a stale delivery
 * whose snapshot disagrees with what Stripe says now.
 */
function deliver(subscription: Record<string, unknown>, current?: Record<string, unknown>) {
  constructWebhookEventMock.mockReturnValue({
    type: 'customer.subscription.updated',
    data: { object: stripeSubscription(subscription) },
  })
  retrieveSubscriptionMock.mockResolvedValue(stripeSubscription(current ?? subscription))
}

beforeEach(() => {
  vi.clearAllMocks()
  // First lookup finds our row; later lookups (the price to plan match)
  // find nothing, so the plan is left alone unless a test says otherwise.
  selectMock.mockReturnValueOnce(rows([EXISTING_ROW])).mockReturnValue(rows([]))
  updateSubscriptionStatusMock.mockResolvedValue(undefined)
  updateSubscriptionPlanMock.mockResolvedValue(undefined)
  updateSubscriptionPeriodMock.mockResolvedValue(undefined)
})

describe('customer.subscription.updated syncs status', () => {
  it('records a cancellation made outside the app', async () => {
    // Stripe still reports active: cancel_at_period_end is what makes it a
    // cancellation, and our row uses the same meaning our cancel route does.
    deliver({ status: 'active', cancel_at_period_end: true })

    await post()

    expect(updateSubscriptionStatusMock).toHaveBeenCalledWith(
      'tenant-1',
      'canceled',
      expect.objectContaining({ canceledAt: expect.any(Date) }),
    )
  })

  it('records a reactivation made outside the app', async () => {
    selectMock.mockReset()
    selectMock
      .mockReturnValueOnce(rows([{ ...EXISTING_ROW, status: 'canceled', canceledAt: new Date() }]))
      .mockReturnValue(rows([]))
    deliver({ status: 'active', cancel_at_period_end: false })

    await post()

    // The timestamp has to go, or the row keeps saying it is on its way out.
    expect(updateSubscriptionStatusMock).toHaveBeenCalledWith('tenant-1', 'active', {
      canceledAt: null,
    })
  })

  it('records a failed charge', async () => {
    deliver({ status: 'past_due' })

    await post()

    expect(updateSubscriptionStatusMock).toHaveBeenCalledWith(
      'tenant-1',
      'past_due',
      expect.anything(),
    )
  })

  it('treats unpaid as past_due, since the period check decides access', async () => {
    deliver({ status: 'unpaid' })

    await post()

    expect(updateSubscriptionStatusMock).toHaveBeenCalledWith(
      'tenant-1',
      'past_due',
      expect.anything(),
    )
  })

  it('writes nothing when the status has not changed', async () => {
    deliver({ status: 'active', cancel_at_period_end: false })

    await post()

    expect(updateSubscriptionStatusMock).not.toHaveBeenCalled()
  })

  it('treats paused as past_due so the access actually lapses', async () => {
    // Holding `trialing` would be the worst answer: trialing access ignores
    // the period end, so a trial paused for want of a payment method would
    // keep working forever.
    deliver({ status: 'paused' })

    await post()

    expect(updateSubscriptionStatusMock).toHaveBeenCalledWith(
      'tenant-1',
      'past_due',
      expect.anything(),
    )
  })

  it('leaves the row alone for a status we have no name for', async () => {
    // `incomplete` is a checkout still in flight, not a state to act on.
    deliver({ status: 'incomplete' })

    await post()

    expect(updateSubscriptionStatusMock).not.toHaveBeenCalled()
  })

  it('writes what Stripe says now, not what a stale event carried', async () => {
    // The subscription was cancelled after this event was created. Applying
    // the snapshot would resurrect it, and `active` ignores the period end,
    // so the access would never lapse again.
    deliver(
      { status: 'active', cancel_at_period_end: false },
      { status: 'canceled' },
    )

    await post()

    expect(updateSubscriptionStatusMock).toHaveBeenCalledWith(
      'tenant-1',
      'canceled',
      expect.anything(),
    )
  })

  it('keeps the original cancellation timestamp when one exists', async () => {
    const original = new Date('2026-08-20T00:00:00.000Z')
    selectMock.mockReset()
    selectMock
      .mockReturnValueOnce(rows([{ ...EXISTING_ROW, status: 'active', canceledAt: original }]))
      .mockReturnValue(rows([]))
    deliver({ status: 'active', cancel_at_period_end: true })

    await post()

    expect(updateSubscriptionStatusMock).toHaveBeenCalledWith('tenant-1', 'canceled', {
      canceledAt: original,
    })
  })

  it('ignores an event for a subscription we do not have', async () => {
    selectMock.mockReset()
    selectMock.mockReturnValue(rows([]))
    deliver({ status: 'past_due' })

    await post()

    expect(updateSubscriptionStatusMock).not.toHaveBeenCalled()
    expect(updateSubscriptionPlanMock).not.toHaveBeenCalled()
  })
})

/**
 * `invoice.paid` used to take the billing period from `invoice.lines.data[0]`.
 *
 * Stripe does not order that list with the recurring line first. After a
 * prorated plan switch the renewal invoice also carries proration lines, and
 * a proration line's period covers the tail of the OLD cycle, which by the
 * time the invoice is paid has already passed. Storing it made a subscription
 * that was paid for a month ahead read as lapsed: the banner told the owner
 * their subscription had ended, and `checkout` treated it as dead and opened
 * a SECOND Stripe subscription alongside the live one.
 */
describe('invoice.paid takes the period from the subscription', () => {
  const OLD_CYCLE_END = new Date('2026-09-01T00:00:00.000Z')
  const REAL_PERIOD_START = new Date('2026-09-01T00:00:00.000Z')
  const REAL_PERIOD_END = new Date('2026-10-01T00:00:00.000Z')

  function deliverInvoicePaid() {
    constructWebhookEventMock.mockReturnValue({
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_1',
          // Where stripe 22 puts it. The flat `invoice.subscription` this
          // fixture used to carry does not exist on the type at all.
          parent: { subscription_details: { subscription: 'sub_1' } },
          lines: {
            data: [
              // The proration, first in the list, covering the tail of the
              // cycle that has already ended.
              {
                period: {
                  start: new Date('2026-08-20T00:00:00.000Z').getTime() / 1000,
                  end: OLD_CYCLE_END.getTime() / 1000,
                },
              },
              {
                period: {
                  start: REAL_PERIOD_START.getTime() / 1000,
                  end: REAL_PERIOD_END.getTime() / 1000,
                },
              },
            ],
          },
        },
      },
    })
    retrieveSubscriptionMock.mockResolvedValue({
      ...stripeSubscription({ status: 'active' }),
      items: {
        data: [
          {
            price: { id: 'price_starter' },
            current_period_start: REAL_PERIOD_START.getTime() / 1000,
            current_period_end: REAL_PERIOD_END.getTime() / 1000,
          },
        ],
      },
    })
  }

  it('stores the real period, not the proration boundary', async () => {
    deliverInvoicePaid()

    await post()

    const [periodWrite] = updateSubscriptionPeriodCalls()
    expect(periodWrite, 'the period was never written').toBeDefined()
    expect(periodWrite[1]).toEqual({
      currentPeriodStart: REAL_PERIOD_START,
      currentPeriodEnd: REAL_PERIOD_END,
    })
  })

  it('does not store the already-closed boundary the first line carried', async () => {
    deliverInvoicePaid()

    await post()

    const [periodWrite] = updateSubscriptionPeriodCalls()
    expect(periodWrite[1].currentPeriodEnd).not.toEqual(OLD_CYCLE_END)
  })
})
