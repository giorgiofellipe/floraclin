import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'

// Lets a test choose the "random" codes getOrCreateReferralCode generates; other tests never generate one.
const generated = vi.hoisted(() => ({ queue: [] as string[] }))
vi.mock('@/lib/referral/code', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/referral/code')>()),
  generateReferralCode: () => generated.queue.shift() ?? 'ZQQQQQQQ',
}))
import { db } from '@/db/client'
import { untilAdvisoryLockWaiter } from './advisory-lock-waiter'
import { auditLogs, referralCodeAliases, tenantReferrals, tenants, users } from '@/db/schema'
import { MAX_PREVIOUS_REFERRAL_CODES, REFERRAL_CODE_CHANGES_PER_DAY } from '@/lib/referral/custom-code'
import {
  REFERRAL_CODE_AUDIT_ENTITY,
  findReferrerByCode,
  getOrCreateReferralCode,
  insertReferral,
  isReferralCodeAvailable,
  listPreviousReferralCodes,
  updateReferralCode,
} from '../referrals'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const USER = '00000000-0000-0000-0000-0000000c0d91'

async function codeOf(tenantId: string) {
  const [row] = await db.select({ code: tenants.referralCode }).from(tenants).where(eq(tenants.id, tenantId))
  return row?.code ?? null
}

// audit_logs is append-only (a trigger refuses deletes), so each test gets fresh tenants: old audit rows can never
// count against its change limit. audit_logs.tenant_id has no foreign key, so the tenants are deleted afterwards.
let TENANT_A: string
let TENANT_B: string
let REFERRED: string
const created: string[] = []
const FIXED_CODES = [
  'ZQABC234', 'ZQDRAMICAELA', 'ZQHOFRACE', 'ZQLIMIT0', 'ZQLIMIT1', 'ZQLIMIT2', 'ZQLIMITX', 'ZQNOVOCOD',
  'ZQALIAS1', 'ZQALIAS2', 'ZQALIAS3', 'ZQALIAS4', 'ZQALIAS5', 'ZQGENOLD', 'ZQGENNEW',
]

describeIntegration('referral code customisation (integration, requires test DB)', () => {
  beforeAll(async () => {
    await db
      .insert(users)
      .values({ id: USER, email: 'referral-code-test@example.com', fullName: 'Referral Code Test' })
      .onConflictDoNothing()
  })

  beforeEach(async () => {
    ;[TENANT_A, TENANT_B, REFERRED] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    for (const id of [TENANT_A, TENANT_B, REFERRED]) {
      await db.insert(tenants).values({ id, name: `Code Test ${id.slice(0, 8)}`, slug: `code-test-${id}` })
      created.push(id)
    }
    // A fixed code from an earlier test or run may still be held or retired; free it before claiming it. The codes
    // start with ZQ so this never touches a real clinic's code in a shared dev/test database.
    await db.delete(referralCodeAliases).where(inArray(referralCodeAliases.code, FIXED_CODES))
    await db.update(tenants).set({ referralCode: null }).where(inArray(tenants.referralCode, FIXED_CODES))
    await db.update(tenants).set({ referralCode: 'ZQABC234' }).where(eq(tenants.id, TENANT_A))
  })

  afterAll(async () => {
    await db.delete(referralCodeAliases).where(inArray(referralCodeAliases.tenantId, created))
    await db.delete(tenantReferrals).where(inArray(tenantReferrals.referredTenantId, created))
    await db.delete(tenants).where(inArray(tenants.id, created))
  })

  it('changes the code, keeps the old one resolving to the same tenant, audits it, and keeps referrals attached', async () => {
    await insertReferral({
      referrerTenantId: TENANT_A,
      referredTenantId: REFERRED,
      code: 'ZQABC234',
      capturedVia: 'link',
      capturedAt: new Date('2026-10-01T12:00:00.000Z'),
      status: 'trial',
      ineligibleReason: null,
      checks: {},
    })

    const result = await updateReferralCode({ tenantId: TENANT_A, userId: USER, code: 'ZQDRAMICAELA' })
    expect(result).toEqual({ outcome: 'updated', code: 'ZQDRAMICAELA', previousCode: 'ZQABC234' })
    expect(await codeOf(TENANT_A)).toBe('ZQDRAMICAELA')
    expect((await findReferrerByCode('ZQABC234'))?.tenantId).toBe(TENANT_A)
    expect((await findReferrerByCode('ZQDRAMICAELA'))?.tenantId).toBe(TENANT_A)
    expect(await listPreviousReferralCodes(TENANT_A)).toEqual(['ZQABC234'])

    const referrals = await db.select().from(tenantReferrals).where(eq(tenantReferrals.referredTenantId, REFERRED))
    expect(referrals.map((r) => r.referrerTenantId)).toEqual([TENANT_A])

    const audits = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, TENANT_A), eq(auditLogs.entityType, REFERRAL_CODE_AUDIT_ENTITY)))
    expect(audits).toHaveLength(1)
    expect(audits[0].changes).toEqual({ referralCode: { old: 'ZQABC234', new: 'ZQDRAMICAELA' } })
  })

  it('refuses a code another tenant holds, and reports availability per tenant', async () => {
    expect(await isReferralCodeAvailable(TENANT_B, 'ZQABC234')).toBe(false)
    expect(await isReferralCodeAvailable(TENANT_A, 'ZQABC234')).toBe(true) // its own code
    expect(await updateReferralCode({ tenantId: TENANT_B, userId: USER, code: 'ZQABC234' })).toEqual({ outcome: 'taken' })
    expect(await codeOf(TENANT_B)).toBeNull()
    expect(await codeOf(TENANT_A)).toBe('ZQABC234')
  })

  // Two pooled connections run these concurrently; the second UPDATE waits on the unique index, then fails.
  it('lets exactly one of two tenants racing for the same code win', async () => {
    const results = await Promise.all([
      updateReferralCode({ tenantId: TENANT_A, userId: USER, code: 'ZQHOFRACE' }),
      updateReferralCode({ tenantId: TENANT_B, userId: USER, code: 'ZQHOFRACE' }),
    ])
    expect(results.map((r) => r.outcome).sort()).toEqual(['taken', 'updated'])
    const [holder] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.referralCode, 'ZQHOFRACE'))
    expect(holder).toBeDefined()
  })

  it(`allows ${REFERRAL_CODE_CHANGES_PER_DAY} changes per rolling 24 h, then refuses until the window passes`, async () => {
    const start = new Date('2026-10-22T12:00:00.000Z')
    for (let i = 0; i < REFERRAL_CODE_CHANGES_PER_DAY; i++) {
      const at = new Date(start.getTime() + i * 60_000)
      expect((await updateReferralCode({ tenantId: TENANT_A, userId: USER, code: `ZQLIMIT${i}`, now: at })).outcome).toBe(
        'updated',
      )
    }
    const blocked = await updateReferralCode({
      tenantId: TENANT_A,
      userId: USER,
      code: 'ZQLIMITX',
      now: new Date(start.getTime() + 60 * 60_000),
    })
    expect(blocked).toEqual({ outcome: 'rate_limited' })
    expect(await codeOf(TENANT_A)).toBe(`ZQLIMIT${REFERRAL_CODE_CHANGES_PER_DAY - 1}`)

    const nextDay = new Date(start.getTime() + 24 * 60 * 60_000 + 60_000)
    expect((await updateReferralCode({ tenantId: TENANT_A, userId: USER, code: 'ZQLIMITX', now: nextDay })).outcome).toBe(
      'updated',
    )
  })

  it('saving the current code is a no-op that does not use up a change', async () => {
    expect(await updateReferralCode({ tenantId: TENANT_A, userId: USER, code: 'ZQABC234' })).toEqual({
      outcome: 'unchanged',
      code: 'ZQABC234',
    })
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, TENANT_A))
    expect(audits).toHaveLength(0)
  })

  it("never lets another tenant claim an old code, and lets the owner switch back to it", async () => {
    await updateReferralCode({ tenantId: TENANT_A, userId: USER, code: 'ZQDRAMICAELA' })

    expect(await isReferralCodeAvailable(TENANT_B, 'ZQABC234')).toBe(false)
    expect(await isReferralCodeAvailable(TENANT_A, 'ZQABC234')).toBe(true)
    expect(await updateReferralCode({ tenantId: TENANT_B, userId: USER, code: 'ZQABC234' })).toEqual({ outcome: 'taken' })

    expect(await updateReferralCode({ tenantId: TENANT_A, userId: USER, code: 'ZQABC234' })).toMatchObject({ outcome: 'updated' })
    expect(await codeOf(TENANT_A)).toBe('ZQABC234')
    expect(await listPreviousReferralCodes(TENANT_A)).toEqual(['ZQDRAMICAELA'])
    expect((await findReferrerByCode('ZQDRAMICAELA'))?.tenantId).toBe(TENANT_A)
  })

  it(`blocks a brand-new code once ${MAX_PREVIOUS_REFERRAL_CODES} old codes exist, but still allows switching back`, async () => {
    const old = Array.from({ length: MAX_PREVIOUS_REFERRAL_CODES }, (_, i) => `ZQALIAS${i + 1}`)
    await db.insert(referralCodeAliases).values(old.map((code) => ({ code, tenantId: TENANT_A })))

    expect(await updateReferralCode({ tenantId: TENANT_A, userId: USER, code: 'ZQNOVOCOD' })).toEqual({ outcome: 'alias_limit' })
    expect(await codeOf(TENANT_A)).toBe('ZQABC234')
    expect(await updateReferralCode({ tenantId: TENANT_A, userId: USER, code: 'ZQALIAS1' })).toMatchObject({ outcome: 'updated' })
    expect((await listPreviousReferralCodes(TENANT_A)).sort()).toEqual(['ZQABC234', 'ZQALIAS2', 'ZQALIAS3', 'ZQALIAS4', 'ZQALIAS5'])
  })

  // B must wait for A's in-flight change to ABC234 (the per-code advisory lock), then see it retired. Without the
  // lock B would answer at once from what it can see, which is the window where the old code could change hands.
  it('makes a claim on a code wait while that code is being retired, then refuses it', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    let locked!: () => void
    const lockTaken = new Promise<void>((resolve) => (locked = resolve))
    const retiring = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'referral_code:ZQABC234'}))`)
      await tx.insert(referralCodeAliases).values({ code: 'ZQABC234', tenantId: TENANT_A })
      await tx.update(tenants).set({ referralCode: 'ZQHOFRACE' }).where(eq(tenants.id, TENANT_A))
      locked()
      await held
    })
    await lockTaken

    const claim = updateReferralCode({ tenantId: TENANT_B, userId: USER, code: 'ZQABC234' })
    await untilAdvisoryLockWaiter()

    release()
    await retiring
    expect(await claim).toEqual({ outcome: 'taken' })
    expect(await codeOf(TENANT_B)).toBeNull()
    expect((await findReferrerByCode('ZQABC234'))?.tenantId).toBe(TENANT_A)
  })

  it("never generates another tenant's old code", async () => {
    await db.insert(referralCodeAliases).values({ code: 'ZQGENOLD', tenantId: TENANT_A })
    generated.queue.push('ZQGENOLD', 'ZQGENNEW')
    expect(await getOrCreateReferralCode(TENANT_B)).toBe('ZQGENNEW')
    expect((await findReferrerByCode('ZQGENOLD'))?.tenantId).toBe(TENANT_A)
  })

  it('prefers the current holder of a code over an old alias, should both ever exist', async () => {
    await db.insert(referralCodeAliases).values({ code: 'ZQGENOLD', tenantId: TENANT_B })
    await db.update(tenants).set({ referralCode: 'ZQGENOLD' }).where(eq(tenants.id, TENANT_A))
    expect((await findReferrerByCode('ZQGENOLD'))?.tenantId).toBe(TENANT_A)
  })
})
