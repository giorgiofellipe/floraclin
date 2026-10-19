import { beforeEach, describe, expect, it, vi } from 'vitest'

type Op = { op: 'lock' | 'update' | 'insert'; inTx: boolean; values?: Record<string, unknown> }

const { state } = vi.hoisted(() => ({
  state: {
    maxVersion: null as number | null,
    existing: null as Record<string, unknown> | null,
    ops: [] as Op[],
  },
}))

vi.mock('@/db/client', () => {
  const makeClient = (inTx: boolean) => ({
    execute: () => {
      state.ops.push({ op: 'lock', inTx })
      return Promise.resolve([])
    },
    select: () => ({
      from: () => ({
        where: () => {
          const rows = inTx ? [{ version: state.maxVersion }] : state.existing ? [state.existing] : []
          return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) })
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.ops.push({ op: 'update', inTx, values })
        return { where: () => Promise.resolve([]) }
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        state.ops.push({ op: 'insert', inTx, values })
        return { returning: () => Promise.resolve([{ id: 'new-id', ...values }]) }
      },
    }),
  })
  const tx = makeClient(true)
  return { db: { ...makeClient(false), transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } }
})

import { createConsentTemplate, updateConsentTemplate } from '@/db/queries/consent'

const GENERAL = { type: 'general' as const, title: 'Consentimento Geral', content: 'Texto padrão' }

beforeEach(() => {
  state.maxVersion = null
  state.existing = null
  state.ops.length = 0
})

describe('createConsentTemplate', () => {
  // Guards onboarding, which seeds each type with createConsentTemplate on an empty tenant.
  it('creates v1 when the tenant has no template of the type', async () => {
    const template = await createConsentTemplate('tenant-1', GENERAL)

    expect(template.version).toBe(1)
    expect(template.isActive).toBe(true)
  })

  // Regression FLORACLIN-1H: saving "general" again always inserted v1 and violated
  // idx_consent_template_version because onboarding already created general v1.
  it('inserts max(version)+1 and deactivates the active one when the type already exists', async () => {
    state.maxVersion = 3

    const template = await createConsentTemplate('tenant-1', GENERAL)

    expect(template).toMatchObject({ type: 'general', version: 4, isActive: true })
    expect(state.ops.map((o) => [o.op, o.inTx])).toEqual([
      ['lock', true],
      ['update', true],
      ['insert', true],
    ])
    expect(state.ops[1].values).toMatchObject({ isActive: false })
  })
})

describe('updateConsentTemplate', () => {
  // Regression: editing a stale row (v1 while v3 exists) inserted existing.version+1 = v2,
  // which already exists and hit the same unique violation.
  it('versions from the highest version of the type, not the edited row', async () => {
    state.existing = { id: 't-1', tenantId: 'tenant-1', type: 'general', title: 'Antigo', version: 1 }
    state.maxVersion = 3

    const template = await updateConsentTemplate('tenant-1', 't-1', { content: 'Novo texto' })

    expect(template).toMatchObject({ type: 'general', title: 'Antigo', version: 4, isActive: true })
  })
})
