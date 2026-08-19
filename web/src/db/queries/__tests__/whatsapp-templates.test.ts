import { describe, it, expect, vi, beforeEach } from 'vitest'

// Each test uses its own tenantId so the module-level template cache in
// db/queries/whatsapp.ts (loadTemplates) never serves a stale fixture from
// a previous test.

interface TemplateFixture {
  id: string
  name: string
  language?: string
  purposeKey: string | null
  systemTemplate: boolean
}

interface TenantFixture {
  id: string
  name: string
  settings: Record<string, unknown> | null
}

let templatesFixture: TemplateFixture[] = []
let tenantFixture: TenantFixture | null = null

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => templatesFixture),
        })),
      })),
    })),
  },
}))

vi.mock('@/db/schema', () => ({
  whatsappConversations: {},
  whatsappMessages: {},
  whatsappTemplates: {},
  whatsappAutomations: {},
  whatsappQueuedMessages: {},
  sseEvents: {},
}))

vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(async () => tenantFixture),
}))

describe('whatsapp template query scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('listTemplates returns only rows matching the tenant own prefix', async () => {
    templatesFixture = [
      { id: 't1', name: 'dra_micaela_floriani_confirm_appointment', purposeKey: null, systemTemplate: false },
      { id: 't2', name: 'dra_nicole_biomedica_esteta_confirm_appointment', purposeKey: null, systemTemplate: false },
      { id: 't3', name: 'dra_micaela_floriani_follow_up', purposeKey: 'follow_up', systemTemplate: false },
    ]
    tenantFixture = {
      id: 'tenant-list-1',
      name: 'Dra Micaela Floriani',
      settings: { whatsapp_template_prefix: 'dra_micaela_floriani' },
    }

    const { listTemplates } = await import('../whatsapp')
    const result = await listTemplates('tenant-list-1')

    expect(result.map((t) => t.id)).toEqual(['t1', 't3'])
  })

  it('always keeps system_template rows regardless of prefix match', async () => {
    templatesFixture = [
      {
        id: 'sys-1',
        name: 'floraclin_shared_system_template',
        purposeKey: 'appointment_confirmation',
        systemTemplate: true,
      },
      { id: 't2', name: 'dra_nicole_biomedica_esteta_confirm_appointment', purposeKey: null, systemTemplate: false },
    ]
    tenantFixture = {
      id: 'tenant-list-2',
      name: 'Dra Micaela Floriani',
      settings: { whatsapp_template_prefix: 'dra_micaela_floriani' },
    }

    const { listTemplates } = await import('../whatsapp')
    const result = await listTemplates('tenant-list-2')

    expect(result.map((t) => t.id)).toEqual(['sys-1'])
  })

  it('falls back to a deterministic prefix derived from the tenant name when none is persisted', async () => {
    templatesFixture = [
      { id: 't1', name: 'clinica_flora_confirm_appointment', purposeKey: null, systemTemplate: false },
      { id: 't2', name: 'some_other_clinic_confirm_appointment', purposeKey: null, systemTemplate: false },
    ]
    tenantFixture = { id: 'tenant-list-3', name: 'Clínica Flora', settings: {} }

    const { listTemplates } = await import('../whatsapp')
    const result = await listTemplates('tenant-list-3')

    expect(result.map((t) => t.id)).toEqual(['t1'])
  })

  it('returns everything unfiltered if the tenant cannot be resolved (defensive, should not happen)', async () => {
    templatesFixture = [
      { id: 't1', name: 'anything', purposeKey: null, systemTemplate: false },
    ]
    tenantFixture = null

    const { listTemplates } = await import('../whatsapp')
    const result = await listTemplates('tenant-list-missing')

    expect(result.map((t) => t.id)).toEqual(['t1'])
  })

  it('getTemplateByPurpose (send path) still resolves a template for a tenant with its own number', async () => {
    templatesFixture = [
      {
        id: 't1',
        name: 'dra_micaela_floriani_confirm_appointment',
        language: 'pt_BR',
        purposeKey: 'appointment_confirmation',
        systemTemplate: false,
      },
    ]
    tenantFixture = {
      id: 'tenant-send-1',
      name: 'Dra Micaela Floriani',
      settings: { whatsapp_template_prefix: 'dra_micaela_floriani' },
    }

    const { getTemplateByPurpose } = await import('../whatsapp')
    const result = await getTemplateByPurpose('tenant-send-1', 'appointment_confirmation')

    expect(result?.id).toBe('t1')
  })

  it('listSystemTemplates ignores the tenant prefix filter (shared-number clinics read these)', async () => {
    templatesFixture = [
      {
        id: 'sys-1',
        name: 'clinica_floraclin_confirm_appointment',
        purposeKey: 'appointment_confirmation',
        systemTemplate: true,
      },
    ]
    // The system rows live under whichever tenant seeded them, so the caller's
    // tenant is irrelevant here -- and never even looked up.
    tenantFixture = null

    const { listSystemTemplates } = await import('../whatsapp')
    const result = await listSystemTemplates()

    expect(result.map((t) => t.id)).toEqual(['sys-1'])
  })

  it('send path is not affected by the UI-only prefix filter (loadTemplates stays unfiltered)', async () => {
    // A row whose name would NOT pass the prefix filter (e.g. renamed
    // tenant, or a legacy row from before prefixes existed) must still be
    // reachable by purposeKey on the send path -- only listTemplates (the
    // settings UI) applies the prefix filter.
    templatesFixture = [
      {
        id: 't1',
        name: 'legacy_name_that_predates_prefix_scheme',
        language: 'pt_BR',
        purposeKey: 'appointment_confirmation',
        systemTemplate: false,
      },
    ]
    tenantFixture = {
      id: 'tenant-send-2',
      name: 'Dra Micaela Floriani',
      settings: { whatsapp_template_prefix: 'dra_micaela_floriani' },
    }

    const { getTemplateByPurpose, listTemplates } = await import('../whatsapp')

    const sendResult = await getTemplateByPurpose('tenant-send-2', 'appointment_confirmation')
    expect(sendResult?.id).toBe('t1')

    const uiResult = await listTemplates('tenant-send-2')
    expect(uiResult.map((t) => t.id)).toEqual([])
  })
})
