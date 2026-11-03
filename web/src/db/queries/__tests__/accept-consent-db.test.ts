import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/db/client'
import { consentTemplates, patients, procedureRecords, procedureTypes, tenants, users } from '@/db/schema'
import { ConsentProcedureMismatchError, acceptConsent } from '../consent'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const TENANT = '00000000-0000-0000-0000-0000000c0a01'
const USER = '00000000-0000-0000-0000-0000000c0a02'
const ANA = '00000000-0000-0000-0000-0000000c0a03'
const BIA = '00000000-0000-0000-0000-0000000c0a04'
const TYPE = '00000000-0000-0000-0000-0000000c0a05'
const ANA_PROCEDURE = '00000000-0000-0000-0000-0000000c0a06'
const BIA_PROCEDURE = '00000000-0000-0000-0000-0000000c0a07'
const TEMPLATE = '00000000-0000-0000-0000-0000000c0a08'

describeIntegration('acceptConsent (integration, requires test DB)', () => {
  beforeAll(async () => {
    await db.insert(tenants).values({ id: TENANT, name: 'Consent', slug: 'accept-consent-test' })
    await db.insert(users).values({ id: USER, email: 'consent@test.local', fullName: 'Dra.' })
    await db.insert(patients).values([
      { id: ANA, tenantId: TENANT, fullName: 'Ana', phone: '11999990000' },
      { id: BIA, tenantId: TENANT, fullName: 'Bia', phone: '11999990001' },
    ])
    await db.insert(procedureTypes).values({ id: TYPE, tenantId: TENANT, name: 'Botox', category: 'toxin' })
    await db.insert(procedureRecords).values([
      { id: ANA_PROCEDURE, tenantId: TENANT, patientId: ANA, practitionerId: USER, procedureTypeId: TYPE },
      { id: BIA_PROCEDURE, tenantId: TENANT, patientId: BIA, practitionerId: USER, procedureTypeId: TYPE },
    ])
    await db.insert(consentTemplates).values({ id: TEMPLATE, tenantId: TENANT, type: 'botox', title: 'Botox', content: 'Termo' })
  })

  const accept = (procedureRecordId: string) =>
    acceptConsent(TENANT, { patientId: ANA, consentTemplateId: TEMPLATE, procedureRecordId, acceptanceMethod: 'checkbox' }, {})

  it("rejects linking the acceptance to another patient's procedure", async () => {
    await expect(accept(BIA_PROCEDURE)).rejects.toBeInstanceOf(ConsentProcedureMismatchError)
  })

  it("links the acceptance to the patient's own procedure", async () => {
    const acceptance = await accept(ANA_PROCEDURE)
    expect(acceptance.procedureRecordId).toBe(ANA_PROCEDURE)
  })
})
