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
  recorded: { inserted: [] as unknown[], updated: [] as unknown[] },
  results: { existing: [] as unknown[] },
}))

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
        return { returning: () => Promise.resolve([{ id: 'a1', updatedAt: new Date() }]) }
      },
    }),
    update: () => ({
      set: (v: unknown) => {
        recorded.updated.push(v)
        return {
          where: () => ({
            returning: () => Promise.resolve([{ id: 'a1', updatedAt: new Date() }]),
          }),
        }
      },
    }),
  },
}))

vi.mock('@/db/schema', () => ({
  anamneses: { tenantId: 'anamneses.tenant_id', patientId: 'anamneses.patient_id' },
  patients: {
    id: 'patients.id',
    tenantId: 'patients.tenant_id',
    deletedAt: 'patients.deleted_at',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }),
  and: (...parts: unknown[]) => ({ op: 'and', parts }),
}))

vi.mock('@/db/queries/helpers', () => ({
  verifyTenantOwnership: vi.fn(),
}))

import { verifyTenantOwnership } from '@/db/queries/helpers'
import { patients } from '@/db/schema'
import { upsertAnamnesis } from '@/db/queries/anamnesis'
import { anamnesisSchema, type AnamnesisFormData } from '@/validations/anamnesis'

const DATA: AnamnesisFormData = anamnesisSchema.parse({})

const FOREIGN_PATIENT = new Error('Patient not found or does not belong to this tenant')

beforeEach(() => {
  recorded.inserted.length = 0
  recorded.updated.length = 0
  results.existing = []
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
