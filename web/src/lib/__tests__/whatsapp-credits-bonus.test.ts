import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SQL } from 'drizzle-orm'

const h = vi.hoisted(() => {
  const selectQueue: unknown[][] = []
  const updateSets: Record<string, unknown>[] = []
  const updateReturns: unknown[][] = []
  const insertValues: Record<string, unknown>[] = []
  const reportMock = vi.fn()
  const state = { insertReturn: [] as unknown[], eventSelects: 0, eventResult: (async () => []) as () => Promise<unknown[]> }

  function makeExec() {
    return {
      select: () => {
        const chain: Record<string, unknown> = {
          from: (table: unknown) => {
            if (table === 'EVENTS') {
              state.eventSelects++
              const ev: Record<string, unknown> = {
                where: () => ev,
                orderBy: () => ev,
                limit: () => state.eventResult(),
              }
              return ev
            }
            return chain
          },
          innerJoin: () => chain,
          where: () => chain,
          limit: () => Promise.resolve(selectQueue.shift() ?? []),
        }
        return chain
      },
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updateSets.push(values)
          return { where: () => ({ returning: () => Promise.resolve(updateReturns.shift() ?? []) }) }
        },
      }),
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          insertValues.push(v)
          return { onConflictDoNothing: () => ({ returning: () => Promise.resolve(state.insertReturn) }) }
        },
      }),
    }
  }
  const dbMock = makeExec()
  return { selectQueue, updateSets, updateReturns, insertValues, reportMock, makeExec, dbMock, state }
})
const { selectQueue, updateSets, updateReturns, insertValues, reportMock, makeExec, dbMock, state } = h
vi.mock('@/db/client', () => ({ db: h.dbMock }))
vi.mock('@/db/schema', () => ({
  whatsappCredits: {
    id: 'id', tenantId: 'tenantId', periodStart: 'periodStart', creditsTotal: 'creditsTotal',
    bonusCredits: 'bonusCredits', bonusSource: 'bonusSource',
  },
  whatsappCreditLedger: {},
  tenantSubscriptions: {},
  plans: {},
  referralRewardEvents: 'EVENTS',
}))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: (...a: unknown[]) => h.reportMock(...a) }))

import { periodCreditsTotal } from '../whatsapp-credits'
import { getOrCreateCurrentPeriod, raiseReferralBonus } from '@/db/queries/whatsapp-credits'

const START = new Date('2026-10-01T03:00:00Z')
const BASE_ROW = {
  id: 'p1', creditsUsed: 5, creditsTotal: 300, bonusCredits: 0, periodStart: START, periodEnd: START,
}
const PLAN = (n: number) => [{ limits: { whatsapp_credits: n } }]
const ACTIVE_ENV = { STRIPE_REFERRER_COUPON_IDS: 'a,b,c,d,e' }

beforeEach(() => {
  selectQueue.length = 0
  updateSets.length = 0
  updateReturns.length = 0
  insertValues.length = 0
  state.insertReturn = []
  state.eventSelects = 0
  state.eventResult = async () => []
  reportMock.mockReset()
  vi.unstubAllEnvs()
})

describe('periodCreditsTotal', () => {
  it.each([
    [300, 0, 300],
    [300, 200, 500],
    [-1, 200, -1],
    [0, 100, 100],
  ])('(%i, %i) -> %i', (limit, bonus, total) => {
    expect(periodCreditsTotal(limit, bonus)).toBe(total)
  })
})

describe('getOrCreateCurrentPeriod, existing row', () => {
  it('writes credits_total as a SQL expression over bonus_credits and returns RETURNING values', async () => {
    selectQueue.push([BASE_ROW], PLAN(400))
    updateReturns.push([{ creditsTotal: 600, bonusCredits: 200 }])
    const period = await getOrCreateCurrentPeriod('t1')
    expect(updateSets[0].creditsTotal).toBeInstanceOf(SQL)
    // M5: the read row said bonus 0, a raise landed in between
    expect(period.creditsTotal).toBe(600)
    expect(period.bonusCredits).toBe(200)
  })

  it('skips the UPDATE when the stored total already matches the plan and bonus', async () => {
    selectQueue.push([{ ...BASE_ROW, creditsTotal: 500, bonusCredits: 200 }], PLAN(300))
    const period = await getOrCreateCurrentPeriod('t1')
    expect(updateSets).toHaveLength(0)
    expect(period).toMatchObject({ creditsTotal: 500, bonusCredits: 200 })
  })

  it('passes an unlimited plan change (-1) through', async () => {
    selectQueue.push([BASE_ROW], PLAN(-1))
    updateReturns.push([{ creditsTotal: -1, bonusCredits: 0 }])
    expect((await getOrCreateCurrentPeriod('t1')).creditsTotal).toBe(-1)
  })

  it('falls back to the stored bonus when the conditional UPDATE matched no row', async () => {
    selectQueue.push([{ ...BASE_ROW, creditsTotal: 300, bonusCredits: 200 }], PLAN(300))
    updateReturns.push([])
    const period = await getOrCreateCurrentPeriod('t1')
    expect(period.creditsTotal).toBe(500)
    expect(period.bonusCredits).toBe(200)
  })
})

describe('getOrCreateCurrentPeriod, insert path', () => {
  function created(total: number, bonus: number) {
    state.insertReturn = [{ ...BASE_ROW, creditsTotal: total, bonusCredits: bonus, creditsUsed: 0 }]
  }

  it('gives bonus 0 and runs no reward-event query when unconfigured', async () => {
    vi.stubEnv('STRIPE_REFERRER_COUPON_IDS', '')
    selectQueue.push([], PLAN(300))
    created(300, 0)
    await getOrCreateCurrentPeriod('t1')
    expect(state.eventSelects).toBe(0)
    expect(insertValues[0]).toMatchObject({ bonusCredits: 0, bonusSource: null, creditsTotal: 300 })
  })

  it('uses the latest event bonus when rewards are active', async () => {
    vi.stubEnv('STRIPE_REFERRER_COUPON_IDS', ACTIVE_ENV.STRIPE_REFERRER_COUPON_IDS)
    selectQueue.push([], PLAN(300))
    state.eventResult = async () => [{ bonusCredits: 200 }]
    created(500, 200)
    const period = await getOrCreateCurrentPeriod('t1')
    expect(insertValues[0]).toMatchObject({ bonusCredits: 200, bonusSource: 'referral', creditsTotal: 500 })
    expect(period.bonusCredits).toBe(200)
  })

  it('gives bonus 0 when there is no event', async () => {
    vi.stubEnv('STRIPE_REFERRER_COUPON_IDS', ACTIVE_ENV.STRIPE_REFERRER_COUPON_IDS)
    selectQueue.push([], PLAN(300))
    created(300, 0)
    await getOrCreateCurrentPeriod('t1')
    expect(insertValues[0]).toMatchObject({ bonusCredits: 0, bonusSource: null })
  })

  it('returns bonus 0 and reports when the lookup throws', async () => {
    vi.stubEnv('STRIPE_REFERRER_COUPON_IDS', ACTIVE_ENV.STRIPE_REFERRER_COUPON_IDS)
    selectQueue.push([], PLAN(300))
    state.eventResult = async () => { throw new Error('boom') }
    created(300, 0)
    await getOrCreateCurrentPeriod('t1')
    expect(insertValues[0]).toMatchObject({ bonusCredits: 0, creditsTotal: 300 })
    expect(reportMock).toHaveBeenCalledTimes(1)
  })
})

describe('raiseReferralBonus', () => {
  it('is a no-op for target <= 0', async () => {
    selectQueue.push([{ ...BASE_ROW, bonusCredits: 100, creditsTotal: 400 }], PLAN(300))
    updateReturns.push([])
    const result = await raiseReferralBonus('t1', 0)
    expect(result).toEqual({ bonusCredits: 100, creditsTotal: 400 })
    // only the period sync's own update may run; the raise itself must not
    expect(updateSets.every((s) => !('bonusCredits' in s))).toBe(true)
  })

  it('raises through the provided executor', async () => {
    const exec = makeExec()
    const selectSpy = vi.spyOn(exec, 'select')
    const updateSpy = vi.spyOn(exec, 'update')
    const dbSelect = vi.spyOn(dbMock, 'select')
    selectQueue.push([BASE_ROW], PLAN(300))
    updateReturns.push([{ creditsTotal: 500, bonusCredits: 200 }])
    const result = await raiseReferralBonus('t1', 200, exec as unknown as Parameters<typeof raiseReferralBonus>[2])
    expect(result).toEqual({ bonusCredits: 200, creditsTotal: 500 })
    expect(selectSpy).toHaveBeenCalled()
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(dbSelect).not.toHaveBeenCalled()
    expect(updateSets[0].bonusCredits).toBeInstanceOf(SQL)
  })

  it('seeds a new month from the fresh target, not the previous reward event (§7)', async () => {
    vi.stubEnv('STRIPE_REFERRER_COUPON_IDS', ACTIVE_ENV.STRIPE_REFERRER_COUPON_IDS)
    selectQueue.push([], PLAN(300))
    // Last month's event said 200; this sync's target dropped to 100.
    state.eventResult = async () => [{ bonusCredits: 200 }]
    state.insertReturn = [{ ...BASE_ROW, creditsTotal: 400, bonusCredits: 100, creditsUsed: 0 }]
    updateReturns.push([{ creditsTotal: 400, bonusCredits: 100 }])
    const result = await raiseReferralBonus('t1', 100)
    expect(insertValues[0]).toMatchObject({ bonusCredits: 100, bonusSource: 'referral', creditsTotal: 400 })
    expect(state.eventSelects).toBe(0)
    expect(result).toEqual({ bonusCredits: 100, creditsTotal: 400 })
  })
})
