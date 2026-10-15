import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/client'
import { tenants, plans, tenantSubscriptions, whatsappCredits, whatsappCreditLedger } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import {
  spendCredits,
  attachMetaMessageId,
  refundSpend,
  refundSpendByMetaMessageId,
  getOrCreateCurrentPeriod,
  type LedgerSpendInput,
} from '../whatsapp-credits'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const TENANT = '00000000-0000-0000-0000-00000000c0de'
const ENTRY: LedgerSpendInput = {
  actorType: 'system', actorUserId: null, patientId: null, conversationId: null,
  contactName: 'Maria Silva', contactPhone: '5511999990000',
  itemKind: 'text', templateName: null, purposeKey: null, documentLabel: null,
}

const PLAN = '00000000-0000-0000-0000-00000000c0df'

// getOrCreateCurrentPeriod resets credits_total from the plan limit on every
// call, so the total must be set on the plan, not on the period row.
async function setTotal(total: number) {
  await db.update(plans).set({ limits: { whatsapp_credits: total } } as never).where(eq(plans.id, PLAN))
  const period = await getOrCreateCurrentPeriod(TENANT)
  await db.update(whatsappCredits).set({ creditsUsed: 0 }).where(eq(whatsappCredits.id, period.id))
  return period.id
}

async function ledgerSum(periodId: string) {
  const [row] = await db.select({ s: sql<number>`coalesce(sum(amount), 0)::int` })
    .from(whatsappCreditLedger).where(eq(whatsappCreditLedger.creditPeriodId, periodId))
  return row.s
}

async function used(periodId: string) {
  const [row] = await db.select().from(whatsappCredits).where(eq(whatsappCredits.id, periodId))
  return row.creditsUsed
}

describeIntegration('whatsapp credit ledger (integration, requires test DB)', () => {
  beforeAll(async () => {
    await db.insert(tenants).values({ id: TENANT, name: 'Ledger Test', slug: 'ledger-test' }).onConflictDoNothing()
    await db.insert(plans).values({ id: PLAN, slug: 'ledger-test-plan', name: 'Ledger Test', limits: { whatsapp_credits: 0 } }).onConflictDoNothing()
    await db.insert(tenantSubscriptions).values({ tenantId: TENANT, planId: PLAN, status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) }).onConflictDoNothing()
  })

  beforeEach(async () => {
    await db.delete(whatsappCreditLedger).where(eq(whatsappCreditLedger.tenantId, TENANT))
  })

  it('writes the counter and one spend line together', async () => {
    const periodId = await setTotal(10)
    const res = await spendCredits(TENANT, 3, ENTRY)
    expect(res.allowed).toBe(true)
    expect(await used(periodId)).toBe(3)
    expect(await ledgerSum(periodId)).toBe(-3)
  })

  it('writes nothing when credits are exhausted', async () => {
    const periodId = await setTotal(1)
    const res = await spendCredits(TENANT, 3, ENTRY)
    expect(res.allowed).toBe(false)
    expect(await used(periodId)).toBe(0)
    expect(await ledgerSum(periodId)).toBe(0)
  })

  it('lets only one of two racing spends take the last credit', async () => {
    const periodId = await setTotal(1)
    const results = await Promise.all([spendCredits(TENANT, 1, ENTRY), spendCredits(TENANT, 1, ENTRY)])
    expect(results.filter((r) => r.allowed)).toHaveLength(1)
    expect(await used(periodId)).toBe(1)
    expect(await ledgerSum(periodId)).toBe(-1)
  })

  it('refunds a spend once, with its own line, even when asked twice', async () => {
    const periodId = await setTotal(10)
    const res = await spendCredits(TENANT, 1, ENTRY)
    if (!res.allowed) throw new Error('expected allowed')
    expect(await refundSpend(res.spendId, 'send_failed')).toBe(true)
    expect(await refundSpend(res.spendId, 'send_failed')).toBe(false)
    expect(await used(periodId)).toBe(0)
    expect(await ledgerSum(periodId)).toBe(0)
    const lines = await db.select().from(whatsappCreditLedger).where(eq(whatsappCreditLedger.creditPeriodId, periodId))
    const refund = lines.find((l) => l.kind === 'refund')
    expect(refund).toMatchObject({ amount: 1, refundOf: res.spendId, refundReason: 'send_failed', contactName: 'Maria Silva' })
  })

  it('writes a line and counts usage on an unlimited plan', async () => {
    const periodId = await setTotal(-1)
    const res = await spendCredits(TENANT, 3, ENTRY)
    expect(res.allowed).toBe(true)
    expect(await used(periodId)).toBe(3)
    expect(await ledgerSum(periodId)).toBe(-3)
  })

  it('refunds by Meta message id for a delivery failure', async () => {
    const periodId = await setTotal(10)
    const res = await spendCredits(TENANT, 3, ENTRY)
    if (!res.allowed) throw new Error('expected allowed')
    await attachMetaMessageId(res.spendId, 'wamid.ledger-1')
    expect(await refundSpendByMetaMessageId('00000000-0000-0000-0000-00000000dead', 'wamid.ledger-1')).toBe(false)
    expect(await refundSpendByMetaMessageId(TENANT, 'wamid.ledger-1')).toBe(true)
    expect(await refundSpendByMetaMessageId(TENANT, 'wamid.ledger-1')).toBe(false)
    expect(await refundSpendByMetaMessageId(TENANT, 'wamid.unknown')).toBe(false)
    expect(await used(periodId)).toBe(0)
    expect(await ledgerSum(periodId)).toBe(0)
  })
})
