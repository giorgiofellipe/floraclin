import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/db/client'
import { packageTemplates, patients, procedureRecords, procedureTypes, tenants, users } from '@/db/schema'
import { InvalidEncounterProcedureError, finalizeEncounter } from '../encounter-finalize'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const TENANT = '00000000-0000-0000-0000-0000000e0a01'
const OTHER_TENANT = '00000000-0000-0000-0000-0000000e0a02'
const USER = '00000000-0000-0000-0000-0000000e0a03'
const PATIENT = '00000000-0000-0000-0000-0000000e0a04'
const DRAFT = '00000000-0000-0000-0000-0000000e0a05'
const ACTIVE_TYPE = '00000000-0000-0000-0000-0000000e0a06'
const INACTIVE_TYPE = '00000000-0000-0000-0000-0000000e0a07'
const DELETED_TYPE = '00000000-0000-0000-0000-0000000e0a08'
const FOREIGN_TYPE = '00000000-0000-0000-0000-0000000e0a09'
const FOREIGN_TEMPLATE = '00000000-0000-0000-0000-0000000e0a0a'

const line = (procedureTypeId: string) => ({
  procedureTypeId,
  procedureTypeName: 'Botox',
  sessions: 1,
  defaultPrice: 800,
  sourceTemplateLineId: null,
})

const finalize = (procedureTypeId: string, templateId: string | null = null) =>
  finalizeEncounter({
    tenantId: TENANT,
    userId: USER,
    encounterId: crypto.randomUUID(),
    patientId: PATIENT,
    practitionerId: USER,
    cart: {
      templateId,
      templateName: null,
      templateDefaultPrice: null,
      templateValidityMonths: null,
      lines: [line(procedureTypeId)],
      totalOverride: null,
    },
    draftRecordIds: [DRAFT],
    financialPlan: { totalAmount: '800.00', installmentCount: 1, paymentMethod: 'pix' },
    consents: [],
  })

describeIntegration('finalizeEncounter catalog check (integration, requires test DB)', () => {
  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: TENANT, name: 'Catalog', slug: 'finalize-catalog-test' },
      { id: OTHER_TENANT, name: 'Other', slug: 'finalize-catalog-other' },
    ])
    await db.insert(users).values({ id: USER, email: 'catalog@test.local', fullName: 'Dra.' })
    await db.insert(patients).values({ id: PATIENT, tenantId: TENANT, fullName: 'Ana', phone: '11999990000' })
    await db.insert(procedureTypes).values([
      { id: ACTIVE_TYPE, tenantId: TENANT, name: 'Botox', category: 'toxin' },
      { id: INACTIVE_TYPE, tenantId: TENANT, name: 'Old', category: 'toxin', isActive: false },
      { id: DELETED_TYPE, tenantId: TENANT, name: 'Gone', category: 'toxin', deletedAt: new Date() },
      { id: FOREIGN_TYPE, tenantId: OTHER_TENANT, name: 'Foreign', category: 'toxin' },
    ])
    await db.insert(packageTemplates).values({ id: FOREIGN_TEMPLATE, tenantId: OTHER_TENANT, name: 'Foreign pack' })
    await db.insert(procedureRecords).values({
      id: DRAFT, tenantId: TENANT, patientId: PATIENT, practitionerId: USER, procedureTypeId: ACTIVE_TYPE, status: 'draft',
    })
  })

  it.each([
    ['another tenant', FOREIGN_TYPE],
    ['inactive', INACTIVE_TYPE],
    ['deleted', DELETED_TYPE],
  ])('rejects a cart line whose procedure type is %s', async (_name, typeId) => {
    await expect(finalize(typeId)).rejects.toBeInstanceOf(InvalidEncounterProcedureError)
  })

  it("rejects another tenant's package template", async () => {
    await expect(finalize(ACTIVE_TYPE, FOREIGN_TEMPLATE)).rejects.toBeInstanceOf(InvalidEncounterProcedureError)
  })
})
