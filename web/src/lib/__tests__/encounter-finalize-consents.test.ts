import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

/**
 * Approving with unsigned terms must store the required consent set and leave
 * an audit row naming what is still pending, so the pending list can collect it.
 */

const { state, auditMock } = vi.hoisted(() => ({
  state: {
    executeResponses: [] as Array<{ rows: Array<Record<string, unknown>> }>,
    executed: [] as unknown[],
    updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  },
  auditMock: vi.fn(async () => undefined),
}))

vi.mock('@/db/queries/financial', () => ({
  createFinancialEntry: vi.fn(async () => ({ id: 'fe-1', installmentIds: ['inst-1'] })),
}))
vi.mock('@/db/queries/financial-accounts', () => ({
  provisionDefaultAccounts: vi.fn(async () => undefined),
}))
vi.mock('@/lib/audit', () => ({ createAuditLog: auditMock }))
vi.mock('@/db/schema', () => ({
  patientPackages: { __table: 'patientPackages' },
  procedureRecords: { __table: 'procedureRecords' },
  consentAcceptances: { __table: 'consentAcceptances' },
}))
vi.mock('@/db/client', () => {
  const tx = {
    execute: (query: unknown) => {
      state.executed.push(query)
      return Promise.resolve(state.executeResponses.shift() ?? { rows: [] })
    },
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: 'x' }]),
        then: (resolve: (v: unknown) => unknown) => resolve(undefined),
      }),
    }),
    update: (table: { __table: string }) => ({
      set: (set: Record<string, unknown>) => {
        state.updates.push({ table: table.__table, set })
        return { where: () => Promise.resolve(undefined) }
      },
    }),
  }
  return { db: { transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx) } }
})

const { finalizeEncounter } = await import('../encounter-finalize')

const draftId = '00000000-0000-0000-0000-00000000d001'
const input = {
  tenantId: 't-1',
  userId: 'u-1',
  encounterId: 'e-1',
  patientId: 'p-1',
  practitionerId: 'u-1',
  cart: {
    templateId: null,
    templateName: null,
    templateDefaultPrice: null,
    templateValidityMonths: null,
    lines: [
      {
        procedureTypeId: 'pt-1',
        procedureTypeName: 'Botox',
        sessions: 1,
        defaultPrice: 800,
        sourceTemplateLineId: null,
      },
    ],
    totalOverride: null,
  },
  draftRecordIds: [draftId],
  financialPlan: { totalAmount: '800.00', installmentCount: 1, paymentMethod: 'pix' as const },
  consents: [],
}

// Execute order inside finalize: lock, requirements, financial back-fill, signed types.
function queueReads(signedTypes: string[]) {
  state.executeResponses.push(
    { rows: [{ id: draftId, status: 'draft' }] },
    { rows: [{ categories: ['toxina_botulinica'], has_contract: true, valid_type_count: 1, template_valid: true }] },
    { rows: [] },
    { rows: signedTypes.map((type) => ({ type })) },
  )
}

beforeEach(() => {
  state.executeResponses = []
  state.executed = []
  state.updates = []
  auditMock.mockClear()
})

describe('finalizeEncounter required consents', () => {
  it('stores the required set and audits what is still unsigned', async () => {
    queueReads(['general'])

    await finalizeEncounter(input)

    const stored = state.updates.find((u) => u.set.requiredConsentTypes)
    expect(stored?.set.requiredConsentTypes).toEqual(['general', 'botox', 'service_contract'])
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'update',
      entityType: 'procedure_record',
      entityId: draftId,
      changes: { pendingSignatures: { old: null, new: ['botox', 'service_contract'] } },
    }), expect.anything())
  })

  it('only counts signatures on templates of the same tenant', async () => {
    queueReads([])

    await finalizeEncounter(input)

    const signedQuery = new PgDialect().sqlToQuery(state.executed[3] as SQL)
    const templateTenant = signedQuery.sql.match(/t\.tenant_id = \$(\d+)/)
    expect(templateTenant).not.toBeNull()
    expect(signedQuery.params[Number(templateTenant![1]) - 1]).toBe(input.tenantId)
  })

  it('writes no pending audit row when every required consent is signed', async () => {
    queueReads(['general', 'botox', 'service_contract'])

    await finalizeEncounter(input)

    expect(auditMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'procedure_record' }),
      expect.anything(),
    )
  })
})
