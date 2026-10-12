/**
 * `anamneses.patient_id` is globally unique, so a row written as (tenant A,
 * tenant B's patient) is not merely stray data: it occupies the only slot
 * tenant B's patient will ever have, and tenant B's own save then fails on
 * the constraint.
 *
 * `upsertAnamnesis` is reachable from two routes, the token flow and
 * `PUT /api/anamnesis/[patientId]`, which takes the patient id straight from
 * the path. Guarding it here covers both.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { recorded, results } = vi.hoisted(() => ({
  recorded: { inserted: [] as unknown[], updated: [] as unknown[], updateWhere: [] as unknown[] },
  results: {
    existing: [] as unknown[],
    updated: null as unknown[] | null,
    insertConflict: false,
  },
}))

const UNIQUE_VIOLATION = Object.assign(new Error('duplicate key value violates unique constraint'), {
  code: '23505',
})

vi.mock('@/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(results.existing) }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        recorded.inserted.push(v)
        const row = [{ id: 'a1', updatedAt: new Date() }]
        return {
          returning: () =>
            results.insertConflict ? Promise.reject(UNIQUE_VIOLATION) : Promise.resolve(row),
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(results.insertConflict ? [] : row),
          }),
        }
      },
    }),
    update: () => ({
      set: (v: unknown) => {
        recorded.updated.push(v)
        return {
          where: (w: unknown) => {
            recorded.updateWhere.push(w)
            return {
              returning: () =>
                Promise.resolve(results.updated ?? [{ id: 'a1', updatedAt: new Date() }]),
            }
          },
        }
      },
    }),
  },
}))

vi.mock('@/db/schema', () => ({
  anamneses: {
    id: 'anamneses.id',
    tenantId: 'anamneses.tenant_id',
    patientId: 'anamneses.patient_id',
    updatedAt: 'anamneses.updated_at',
    responses: 'anamneses.responses',
  },
  patients: {
    id: 'patients.id',
    tenantId: 'patients.tenant_id',
    deletedAt: 'patients.deleted_at',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }),
  isNotNull: (a: unknown) => ({ op: 'isNotNull', a }),
  and: (...parts: unknown[]) => ({ op: 'and', parts }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', strings, values }),
}))

vi.mock('@/db/queries/helpers', () => ({
  verifyTenantOwnership: vi.fn(),
}))

import { verifyTenantOwnership } from '@/db/queries/helpers'
import { patients } from '@/db/schema'
import { upsertAnamnesis, StaleDataError } from '@/db/queries/anamnesis'

const DATA = { templateVersion: 0, templateSnapshot: [], responses: {} }

const FOREIGN_PATIENT = new Error('Patient not found or does not belong to this tenant')

beforeEach(() => {
  recorded.inserted.length = 0
  recorded.updated.length = 0
  recorded.updateWhere.length = 0
  results.existing = []
  results.updated = null
  results.insertConflict = false
  vi.mocked(verifyTenantOwnership).mockReset()
  vi.mocked(verifyTenantOwnership).mockResolvedValue(undefined)
})

describe('upsertAnamnesis', () => {
  it('checks the patient belongs to the tenant before writing', async () => {
    await upsertAnamnesis('tenant-1', 'patient-1', 'user-1', DATA)

    expect(verifyTenantOwnership).toHaveBeenCalledWith(
      'tenant-1',
      patients,
      'patient-1',
      'Patient',
    )
    expect(recorded.inserted).toHaveLength(1)
  })

  it('inserts nothing when the patient belongs to another tenant', async () => {
    vi.mocked(verifyTenantOwnership).mockRejectedValueOnce(FOREIGN_PATIENT)

    await expect(
      upsertAnamnesis('tenant-1', 'victim-patient', 'user-1', DATA),
    ).rejects.toThrow('does not belong to this tenant')

    expect(recorded.inserted).toHaveLength(0)
  })

  it('updates nothing when the patient belongs to another tenant', async () => {
    // A row for this patient already exists, so an unguarded call would take
    // the update branch and never reach the insert the previous case covers.
    results.existing = [{ id: 'a1', updatedAt: new Date() }]
    vi.mocked(verifyTenantOwnership).mockRejectedValueOnce(FOREIGN_PATIENT)

    await expect(
      upsertAnamnesis('tenant-1', 'victim-patient', 'user-1', DATA),
    ).rejects.toThrow('does not belong to this tenant')

    expect(recorded.updated).toHaveLength(0)
  })
})

describe('upsertAnamnesis optimistic lock', () => {
  const READ_AT = new Date('2026-10-12T15:00:00.123Z')

  // Regression: the lock was a read-then-compare in JS, so a save landing
  // between that read and the UPDATE was silently overwritten.
  it('puts the expected updated_at in the UPDATE filter and throws stale when it matches no row', async () => {
    results.existing = [{ id: 'a1', patientId: 'patient-1', updatedAt: READ_AT }]
    results.updated = []

    await expect(
      upsertAnamnesis('tenant-1', 'patient-1', 'user-1', DATA, READ_AT),
    ).rejects.toBeInstanceOf(StaleDataError)

    expect(JSON.stringify(recorded.updateWhere[0])).toContain(READ_AT.toISOString())
  })

  // Regression: two first saves racing for the same patient hit the unique
  // patient_id constraint and surfaced as a 500 instead of a stale 409.
  it('throws stale when a concurrent insert already took the patient row', async () => {
    results.insertConflict = true

    await expect(
      upsertAnamnesis('tenant-1', 'patient-1', 'user-1', DATA),
    ).rejects.toBeInstanceOf(StaleDataError)
  })

  // Regression: getAnamnesis reads an unconverted legacy row (responses NULL) as {}, so a save on it
  // wrote over the legacy answers before the conversion script reached the row.
  it('only updates a row whose responses are not null', async () => {
    results.existing = [{ id: 'a1', patientId: 'patient-1', responses: null, updatedAt: READ_AT }]

    await upsertAnamnesis('tenant-1', 'patient-1', 'user-1', DATA, READ_AT)

    expect(recorded.updateWhere[0]).toMatchObject({
      parts: expect.arrayContaining([{ op: 'isNotNull', a: 'anamneses.responses' }]),
    })
  })
})
