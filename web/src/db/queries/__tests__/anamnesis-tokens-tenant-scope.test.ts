/**
 * `anamnesis_tokens` references `patients` and `tenants` independently, so
 * nothing in the database stops a row from pairing one tenant with another
 * tenant's patient. Two guards, tested here:
 *
 *   - `createAnamnesisToken` refuses to write the pair. This is the invariant,
 *     and it holds for every caller.
 *   - `getValidToken` refuses to resolve a pair written before that guard
 *     existed, and drops soft-deleted patients so a link that outlives its
 *     patient shows the ordinary "link expirado" page instead of letting them
 *     fill the whole form and fail the save.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { recorded } = vi.hoisted(() => ({
  recorded: { joinOn: [] as unknown[], inserted: [] as unknown[] },
}))

vi.mock('@/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: (_table: unknown, on: unknown) => {
          recorded.joinOn.push(on)
          return { where: () => ({ limit: () => Promise.resolve([]) }) }
        },
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        recorded.inserted.push(v)
        return { returning: () => Promise.resolve([{ token: 'tok', expiresAt: new Date() }]) }
      },
    }),
  },
}))

vi.mock('@/db/schema', () => ({
  anamnesisTokens: {
    id: 'anamnesis_tokens.id',
    token: 'anamnesis_tokens.token',
    patientId: 'anamnesis_tokens.patient_id',
    tenantId: 'anamnesis_tokens.tenant_id',
    createdBy: 'anamnesis_tokens.created_by',
    expiresAt: 'anamnesis_tokens.expires_at',
    usedAt: 'anamnesis_tokens.used_at',
  },
  patients: {
    id: 'patients.id',
    tenantId: 'patients.tenant_id',
    fullName: 'patients.full_name',
    deletedAt: 'patients.deleted_at',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }),
  and: (...parts: unknown[]) => ({ op: 'and', parts }),
  isNull: (a: unknown) => ({ op: 'isNull', a }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: 'sql',
    strings: [...strings],
    values,
  }),
}))

vi.mock('@/db/queries/helpers', () => ({
  verifyTenantOwnership: vi.fn(),
}))

import { verifyTenantOwnership } from '@/db/queries/helpers'
import { patients } from '@/db/schema'
import { createAnamnesisToken, getValidToken } from '@/db/queries/anamnesis-tokens'

beforeEach(() => {
  recorded.joinOn.length = 0
  recorded.inserted.length = 0
  vi.mocked(verifyTenantOwnership).mockReset()
  vi.mocked(verifyTenantOwnership).mockResolvedValue(undefined)
})

describe('createAnamnesisToken', () => {
  it('checks the patient belongs to the tenant before inserting', async () => {
    await createAnamnesisToken('tenant-1', 'patient-1', 'user-1')

    expect(verifyTenantOwnership).toHaveBeenCalledWith(
      'tenant-1',
      patients,
      'patient-1',
      'Patient',
    )
    expect(recorded.inserted).toHaveLength(1)
  })

  it('writes nothing when the patient belongs to another tenant', async () => {
    vi.mocked(verifyTenantOwnership).mockRejectedValueOnce(
      new Error('Patient not found or does not belong to this tenant'),
    )

    await expect(
      createAnamnesisToken('tenant-1', 'victim-patient', 'user-1'),
    ).rejects.toThrow('does not belong to this tenant')

    expect(recorded.inserted).toHaveLength(0)
  })
})

describe('getValidToken', () => {
  it('joins the patient on id, tenant, and not-deleted', async () => {
    await getValidToken('some-token')

    expect(recorded.joinOn).toEqual([
      {
        op: 'and',
        parts: [
          { op: 'eq', a: 'patients.id', b: 'anamnesis_tokens.patient_id' },
          { op: 'eq', a: 'patients.tenant_id', b: 'anamnesis_tokens.tenant_id' },
          { op: 'isNull', a: 'patients.deleted_at' },
        ],
      },
    ])
  })
})
