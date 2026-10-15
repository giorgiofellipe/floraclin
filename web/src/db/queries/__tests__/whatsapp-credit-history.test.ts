import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/client'
import { tenants, plans, tenantSubscriptions, whatsappCreditLedger, patients } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getOrCreateCurrentPeriod } from '../whatsapp-credits'
import { decodeLedgerCursor, listLedgerEntries } from '../whatsapp-credit-history'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const TENANT = '00000000-0000-0000-0000-00000000c1de'
const PLAN = '00000000-0000-0000-0000-00000000c1df'
const LIVE_PATIENT = '00000000-0000-0000-0000-00000000c1e0'
const DELETED_PATIENT = '00000000-0000-0000-0000-00000000c1e1'

const BASE = {
  tenantId: TENANT,
  actorType: 'system',
  contactName: 'Maria Silva',
  contactPhone: '5511999990000',
  itemKind: 'text',
} as const

describeIntegration('whatsapp credit history (integration, requires test DB)', () => {
  let periodId: string

  beforeAll(async () => {
    await db.insert(tenants).values({ id: TENANT, name: 'History Test', slug: 'history-test' }).onConflictDoNothing()
    await db.insert(plans).values({ id: PLAN, slug: 'history-test-plan', name: 'History Test', limits: { whatsapp_credits: 100 } }).onConflictDoNothing()
    await db.insert(patients).values([
      { id: LIVE_PATIENT, tenantId: TENANT, fullName: 'Maria Silva', phone: '11999990000' },
      { id: DELETED_PATIENT, tenantId: TENANT, fullName: 'João Lima', phone: '11999990001', deletedAt: new Date() },
    ]).onConflictDoNothing()
    await db.insert(tenantSubscriptions).values({ tenantId: TENANT, planId: PLAN, status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) }).onConflictDoNothing()
  })

  beforeEach(async () => {
    await db.delete(whatsappCreditLedger).where(eq(whatsappCreditLedger.tenantId, TENANT))
    periodId = (await getOrCreateCurrentPeriod(TENANT)).id
  })

  it('pages lines that share a created_at without skipping or repeating any', async () => {
    const tie = new Date('2026-10-15T12:00:00.123Z')
    await db.insert(whatsappCreditLedger).values([
      { ...BASE, creditPeriodId: periodId, kind: 'spend', amount: -1, createdAt: tie },
      { ...BASE, creditPeriodId: periodId, kind: 'spend', amount: -1, createdAt: tie },
      { ...BASE, creditPeriodId: periodId, kind: 'spend', amount: -1, createdAt: tie },
      { ...BASE, creditPeriodId: periodId, kind: 'spend', amount: -1, createdAt: new Date('2026-10-14T12:00:00.000Z') },
    ])

    const first = await listLedgerEntries(TENANT, periodId, null, 2)
    expect(first.entries).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()

    const cursor = decodeLedgerCursor(first.nextCursor as string)
    const second = await listLedgerEntries(TENANT, periodId, cursor, 2)
    expect(second.entries).toHaveLength(2)
    expect(second.nextCursor).toBeNull()

    const ids = [...first.entries, ...second.entries].map((e) => e.id)
    expect(new Set(ids).size).toBe(4)
  })

  it('labels a refunded template line from its purpose', async () => {
    await db.insert(whatsappCreditLedger).values({
      ...BASE,
      creditPeriodId: periodId,
      kind: 'refund',
      amount: 1,
      refundReason: 'delivery_failed',
      actorType: 'system',
      itemKind: 'template',
      templateName: 'anamnese_v2',
      purposeKey: 'anamnese_link',
    })

    const { entries } = await listLedgerEntries(TENANT, periodId, null)
    expect(entries[0].item).toEqual({ kind: 'template', label: 'Link de anamnese' })
    expect(entries[0].actor).toEqual({ type: 'system', name: null })
    expect(entries[0].recipientName).toBe('Maria Silva')
  })

  it('links only a recipient whose patient record still exists', async () => {
    await db.insert(whatsappCreditLedger).values([
      { ...BASE, creditPeriodId: periodId, kind: 'spend', amount: -1, patientId: LIVE_PATIENT, createdAt: new Date('2026-10-15T12:00:00.000Z') },
      { ...BASE, creditPeriodId: periodId, kind: 'spend', amount: -1, patientId: DELETED_PATIENT, createdAt: new Date('2026-10-14T12:00:00.000Z') },
    ])

    const { entries } = await listLedgerEntries(TENANT, periodId, null)
    expect(entries.map((e) => e.recipientPatientId)).toEqual([LIVE_PATIENT, null])
  })
})
