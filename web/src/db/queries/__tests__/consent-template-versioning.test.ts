import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chain, routedTx, tableOf, whereParams, type LoggedQuery } from '@/tests/mocks/drizzle-tx'
import { auditLogs } from '@/db/schema'

const { dbMock } = vi.hoisted(() => ({ dbMock: { transaction: vi.fn(), select: vi.fn() } }))
vi.mock('@/db/client', () => ({ db: dbMock }))

import { createConsentTemplate, seedDefaultConsentTemplates, updateConsentTemplate } from '@/db/queries/consent'

const TENANT = 'tenant-1'
const GENERAL = { type: 'general' as const, title: 'Consentimento Geral', content: 'Texto padrão' }

let maxVersion: number | null
let log: LoggedQuery[]
// How many tx queries had been issued when the advisory lock ran.
let queriesBeforeLock: number | null

beforeEach(() => {
  vi.clearAllMocks()
  maxVersion = null
  queriesBeforeLock = null

  const routed = routedTx((query) => {
    if (query.op === 'select') return [{ version: maxVersion }]
    if (query.op === 'insert') return [{ id: 'new-id', ...(query.capture.value as object) }]
    return []
  })
  log = routed.log
  const tx = {
    ...routed.tx,
    execute: vi.fn(async () => {
      queriesBeforeLock = log.length
      return []
    }),
  }
  dbMock.transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx))
})

function query(op: LoggedQuery['op']) {
  const found = log.find((q) => q.op === op)
  expect(found, `expected a ${op} inside the transaction`).toBeDefined()
  return found!
}

// The version must come from (and only the active row of) the same tenant and type;
// widening either filter would deactivate or count other tenants'/types' templates.
function expectScopedToTenantAndType() {
  expect(whereParams(query('select').capture)).toEqual([TENANT, 'general'])
  expect(whereParams(query('update').capture)).toEqual([TENANT, 'general', true])
}

describe('createConsentTemplate', () => {
  // Guards onboarding, which seeds each type with createConsentTemplate on an empty tenant.
  it('creates v1 when the tenant has no template of the type', async () => {
    const template = await createConsentTemplate(TENANT, GENERAL)

    expect(template.version).toBe(1)
    expect(template.isActive).toBe(true)
  })

  // Regression FLORACLIN-1H: saving "general" again always inserted v1 and violated
  // idx_consent_template_version because onboarding already created general v1.
  it('inserts max(version)+1 and deactivates the active one when the type already exists', async () => {
    maxVersion = 3

    const template = await createConsentTemplate(TENANT, GENERAL)

    expect(template).toMatchObject({ type: 'general', version: 4, isActive: true })
    expect(queriesBeforeLock).toBe(0)
    expect(log.map((q) => q.op)).toEqual(['select', 'update', 'insert'])
    expect(query('update').capture.value).toMatchObject({ isActive: false })
    expectScopedToTenantAndType()
  })
})

describe('updateConsentTemplate', () => {
  // Regression: editing a stale row (v1 while v3 exists) inserted existing.version+1 = v2,
  // which already exists and hit the same unique violation.
  it('versions from the highest version of the type, not the edited row', async () => {
    dbMock.select.mockReturnValue(
      chain([{ id: 't-1', tenantId: TENANT, type: 'general', title: 'Antigo', version: 1 }])
    )
    maxVersion = 3

    const template = await updateConsentTemplate(TENANT, 't-1', { content: 'Novo texto' })

    expect(template).toMatchObject({ type: 'general', title: 'Antigo', version: 4, isActive: true })
    expect(queriesBeforeLock).toBe(0)
    expectScopedToTenantAndType()
  })
})

describe('seedDefaultConsentTemplates', () => {
  let activeTemplate: { id: string } | null
  // Queries issued before each advisory lock, in order.
  let locks: number[]

  beforeEach(() => {
    activeTemplate = null
    locks = []
    const routed = routedTx((q) => {
      if (q.op === 'select') {
        return q.fields && 'id' in (q.fields as object) ? (activeTemplate ? [activeTemplate] : []) : [{ version: null }]
      }
      if (q.op === 'insert') return [{ id: 'new-id', ...(q.capture.value as object) }]
      return []
    })
    log = routed.log
    const tx = {
      ...routed.tx,
      execute: vi.fn(async () => {
        locks.push(log.length)
        return []
      }),
    }
    dbMock.transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx))
  })

  it('creates v1 of every standard type on a tenant with no active template', async () => {
    const created = await seedDefaultConsentTemplates(TENANT)

    expect(created.map((t) => t.type)).toEqual([
      'general', 'botox', 'filler', 'biostimulator', 'limpeza_pele',
      'enzima', 'skinbooster', 'microagulhamento', 'service_contract',
    ])
    expect(created.every((t) => t.version === 1)).toBe(true)
    expect(whereParams(log[0].capture)).toEqual([TENANT, true])
  })

  // A failed audit insert must roll the seed back; written after the commit, a retry
  // would find the templates and never audit them.
  it('writes one audit row per template inside the seed transaction', async () => {
    await seedDefaultConsentTemplates(TENANT, 'user-1')

    const audits = log.filter((q) => q.op === 'insert' && tableOf(q) === auditLogs)
    expect(audits).toHaveLength(9)
    expect(audits[0].capture.value).toMatchObject({ tenantId: TENANT, userId: 'user-1', entityType: 'consent_template' })
  })

  // "Usar modelos padrão" double click, or an onboarding retry: a second run must not
  // stack v2 copies on top of the clinic's templates.
  it('creates nothing when the tenant already has an active template', async () => {
    activeTemplate = { id: 't-1' }

    const created = await seedDefaultConsentTemplates(TENANT)

    expect(created).toEqual([])
    expect(locks).toEqual([0])
    expect(log.map((q) => q.op)).toEqual(['select'])
  })
})
