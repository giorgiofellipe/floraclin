import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: { row: null as unknown, writes: [] as string[] },
}))

vi.mock('@/db/client', () => {
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: () => ({ limit: () => Promise.resolve(state.row ? [state.row] : []) }),
        }),
      }),
    }),
    update: () => {
      state.writes.push('update')
      return { set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }
    },
    insert: () => {
      state.writes.push('insert')
      return { values: () => ({ onConflictDoUpdate: () => ({ returning: () => Promise.resolve([]) }) }) }
    },
  }
  return { db: { transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } }
})

import { saveAnamnesisTemplate } from '@/db/queries/anamnesis-templates'
import { DEFAULT_ANAMNESIS_TEMPLATE } from '@/lib/anamnesis/default-template'
import type { FormSection } from '@/lib/forms/types'

const STORED: FormSection[] = [
  {
    id: 's1',
    title: 'Geral',
    order: 0,
    questions: [{ id: 'q1', label: 'Queixa', type: 'text', required: false, order: 0 }],
  },
]

// Same content as STORED with the keys in another order, as jsonb returns them.
const REORDERED: FormSection[] = [
  {
    questions: [{ order: 0, required: false, type: 'text', label: 'Queixa', id: 'q1' }],
    order: 0,
    title: 'Geral',
    id: 's1',
  },
]

beforeEach(() => {
  state.row = null
  state.writes.length = 0
})

describe('saveAnamnesisTemplate', () => {
  it('writes nothing when the sections equal the stored ones with keys in another order', async () => {
    // Regression: a no-op save bumped the version and showed the banner on every record.
    state.row = { id: 't1', version: 4, sections: STORED }

    const result = await saveAnamnesisTemplate('tenant-1', REORDERED)

    expect(result).toEqual({ changed: false, template: { version: 4, sections: STORED } })
    expect(state.writes).toEqual([])
  })

  it('writes nothing when saving the default sections for a tenant without a row', async () => {
    // Regression: "Restaurar padrão" on an untouched clinic created version 1 and flagged every record.
    const result = await saveAnamnesisTemplate('tenant-1', structuredClone(DEFAULT_ANAMNESIS_TEMPLATE.sections))

    expect(result.changed).toBe(false)
    expect(state.writes).toEqual([])
  })
})
