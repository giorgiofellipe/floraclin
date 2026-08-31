import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
}))

vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(),
}))

vi.mock('@/lib/plans', () => ({
  subscriptionGate: vi.fn(),
}))

vi.mock('@/db/queries/prospects', () => ({
  listProspects: vi.fn(),
  getProspectStats: vi.fn(),
  createProspect: vi.fn(),
  updateProspect: vi.fn(),
  softDeleteProspect: vi.fn(),
  logProspectActivity: vi.fn(),
  getProspectActivities: vi.fn(),
  getProspectProcedures: vi.fn(),
  getProspectProceduresBatch: vi.fn(),
  setProspectProcedures: vi.fn(),
  getProspect: vi.fn(),
}))

vi.mock('@/db/queries/whatsapp', () => ({
  pushSseEvent: vi.fn(),
}))

vi.mock('@/lib/meta/events', () => ({
  enqueueMetaEvent: vi.fn(),
}))

import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { subscriptionGate } from '@/lib/plans'
import { createProspect, getProspect, logProspectActivity, updateProspect } from '@/db/queries/prospects'
import { enqueueMetaEvent } from '@/lib/meta/events'
import { POST as createProspectRoute } from '../route'
import { PATCH } from '../[id]/route'

function prospect(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prospect-1',
    tenantId: 'tenant-1',
    phone: '+5511999999999',
    name: 'Maria Souza',
    stage: 'novo',
    source: 'manual',
    assignedUserId: null,
    notes: null,
    lostReason: null,
    convertedPatientId: null,
    marketingOptOut: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'owner',
  } as never)
  vi.mocked(getTenant).mockResolvedValue({
    id: 'tenant-1',
    name: 'Clínica Flora',
    settings: { whatsapp_enabled: true },
  } as never)
  vi.mocked(subscriptionGate).mockResolvedValue(null)
})

function patchRequest(body: Record<string, unknown>) {
  return new Request('https://app.floraclin.com.br/api/crm/prospects/prospect-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

describe('POST /api/crm/prospects', () => {
  it('manual create emits one Lead event', async () => {
    vi.mocked(createProspect).mockResolvedValue(prospect() as never)

    const request = new Request('https://app.floraclin.com.br/api/crm/prospects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Maria Souza', phone: '+5511999999999', source: 'manual' }),
    })

    const res = await createProspectRoute(request)
    expect(res.status).toBe(201)

    expect(enqueueMetaEvent).toHaveBeenCalledTimes(1)
    expect(enqueueMetaEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        eventName: 'Lead',
        eventId: 'lead:prospect-1',
        prospectId: 'prospect-1',
        patientId: null,
        actionSource: 'system_generated',
        contact: { phone: '+5511999999999', fullName: 'Maria Souza' },
      }),
    )
  })
})

describe('PATCH /api/crm/prospects/[id] - stage change emission', () => {
  it('novo -> contatado emits one Contact event', async () => {
    vi.mocked(getProspect).mockResolvedValue(prospect({ stage: 'novo' }) as never)
    vi.mocked(updateProspect).mockResolvedValue(prospect({ stage: 'contatado' }) as never)

    const res = await PATCH(patchRequest({ stage: 'contatado' }), {
      params: Promise.resolve({ id: 'prospect-1' }),
    })
    expect(res.status).toBe(200)

    expect(logProspectActivity).toHaveBeenCalledWith(
      'tenant-1',
      'prospect-1',
      'stage_changed',
      { from: 'novo', to: 'contatado' },
      'user-1',
    )
    expect(enqueueMetaEvent).toHaveBeenCalledTimes(1)
    expect(enqueueMetaEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        eventName: 'Contact',
        eventId: 'contact:prospect-1',
        prospectId: 'prospect-1',
        patientId: null,
        actionSource: 'system_generated',
        contact: { phone: '+5511999999999', fullName: 'Maria Souza' },
      }),
    )
  })

  it('novo -> perdido emits nothing', async () => {
    vi.mocked(getProspect).mockResolvedValue(prospect({ stage: 'novo' }) as never)
    vi.mocked(updateProspect).mockResolvedValue(prospect({ stage: 'perdido' }) as never)

    const res = await PATCH(patchRequest({ stage: 'perdido' }), {
      params: Promise.resolve({ id: 'prospect-1' }),
    })
    expect(res.status).toBe(200)

    expect(enqueueMetaEvent).not.toHaveBeenCalled()
  })

  it('a PATCH that does not change stage emits nothing', async () => {
    vi.mocked(getProspect).mockResolvedValue(prospect({ stage: 'novo' }) as never)
    vi.mocked(updateProspect).mockResolvedValue(prospect({ stage: 'novo' }) as never)

    const res = await PATCH(patchRequest({ stage: 'novo' }), {
      params: Promise.resolve({ id: 'prospect-1' }),
    })
    expect(res.status).toBe(200)

    expect(logProspectActivity).not.toHaveBeenCalledWith(
      'tenant-1',
      'prospect-1',
      'stage_changed',
      expect.anything(),
      'user-1',
    )
    expect(enqueueMetaEvent).not.toHaveBeenCalled()
  })

  it('moving a lead into agendado emits one Schedule event, keyed on the lead', async () => {
    vi.mocked(getProspect).mockResolvedValue(prospect({ stage: 'qualificado' }) as never)
    vi.mocked(updateProspect).mockResolvedValue(prospect({ stage: 'agendado' }) as never)

    const res = await PATCH(patchRequest({ stage: 'agendado' }), {
      params: Promise.resolve({ id: 'prospect-1' }),
    })
    expect(res.status).toBe(200)

    expect(enqueueMetaEvent).toHaveBeenCalledTimes(1)
    expect(enqueueMetaEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        eventName: 'Schedule',
        eventId: 'schedule:prospect-1',
        prospectId: 'prospect-1',
        patientId: null,
        actionSource: 'system_generated',
        contact: { phone: '+5511999999999', fullName: 'Maria Souza' },
      }),
    )
  })
})

describe('converted leads forward the patient id so the opt-out flag is reachable', () => {
  it('POST forwards convertedPatientId on Lead', async () => {
    vi.mocked(createProspect).mockResolvedValue(
      prospect({ convertedPatientId: 'patient-1' }) as never,
    )

    const request = new Request('https://app.floraclin.com.br/api/crm/prospects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Maria Souza', phone: '+5511999999999', source: 'manual' }),
    })

    const res = await createProspectRoute(request)
    expect(res.status).toBe(201)
    expect(enqueueMetaEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'Lead', patientId: 'patient-1' }),
    )
  })

  it('PATCH forwards convertedPatientId on Contact', async () => {
    vi.mocked(getProspect).mockResolvedValue(prospect({ stage: 'novo' }) as never)
    vi.mocked(updateProspect).mockResolvedValue(
      prospect({ stage: 'contatado', convertedPatientId: 'patient-1' }) as never,
    )

    const res = await PATCH(patchRequest({ stage: 'contatado' }), {
      params: Promise.resolve({ id: 'prospect-1' }),
    })
    expect(res.status).toBe(200)
    expect(enqueueMetaEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'Contact', patientId: 'patient-1' }),
    )
  })

  it('PATCH forwards convertedPatientId on Schedule', async () => {
    vi.mocked(getProspect).mockResolvedValue(prospect({ stage: 'qualificado' }) as never)
    vi.mocked(updateProspect).mockResolvedValue(
      prospect({ stage: 'agendado', convertedPatientId: 'patient-1' }) as never,
    )

    const res = await PATCH(patchRequest({ stage: 'agendado' }), {
      params: Promise.resolve({ id: 'prospect-1' }),
    })
    expect(res.status).toBe(200)
    expect(enqueueMetaEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'Schedule', patientId: 'patient-1' }),
    )
  })
})

describe('an opted-out patient is recorded as skipped, not sent', () => {
  const insertConversionEventMock = vi.fn()
  const postEventsMock = vi.fn()
  const isMarketingOptedOutMock = vi.fn()

  async function loadRealEnqueue() {
    vi.resetModules()
    // The file-level vi.mock of this module is what lets the route tests spy on
    // the call; these two need the real gate underneath it.
    vi.doUnmock('@/lib/meta/events')
    vi.doMock('@/db/queries/marketing-consent', () => ({
      isMarketingOptedOut: isMarketingOptedOutMock,
    }))
    vi.doMock('@/db/queries/meta-events', () => ({
      insertConversionEvent: insertConversionEventMock,
      markEventSent: vi.fn(),
      markEventFailure: vi.fn(),
    }))
    vi.doMock('@/db/queries/meta-connections', () => ({
      getMetaConnection: vi.fn(async () => ({
        datasetId: 'dataset-1',
        accessToken: 'token',
        testEventCode: null,
        advancedMatchingEnabled: true,
      })),
      markConnectionInvalid: vi.fn(),
    }))
    vi.doMock('@/db/queries/lead-attributions', () => ({ getAttribution: vi.fn(async () => null) }))
    vi.doMock('@/lib/meta/capi-client', () => ({ postEvents: postEventsMock }))
    vi.doMock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))

    const mod = await import('@/lib/meta/events')
    return mod.enqueueMetaEvent
  }

  beforeEach(() => {
    insertConversionEventMock.mockReset()
    insertConversionEventMock.mockResolvedValue({ inserted: true, id: 'event-1' })
    postEventsMock.mockReset()
    postEventsMock.mockResolvedValue({ ok: true, fbTraceId: 'trace-1' })
    isMarketingOptedOutMock.mockReset()
    process.env.META_EXTERNAL_ID_SECRET = 'a'.repeat(64)
  })

  const contactEvent = {
    tenantId: 'tenant-1',
    eventName: 'Contact' as const,
    eventId: 'contact:prospect-1',
    eventTime: new Date('2026-08-28T12:00:00Z'),
    prospectId: 'prospect-1',
    contact: { phone: '+5511999999999', fullName: 'Maria Souza' },
    actionSource: 'system_generated' as const,
  }

  it('writes a skipped row and sends nothing when the patient opted out', async () => {
    isMarketingOptedOutMock.mockImplementation(
      async (_tenantId: string, ref: { patientId?: string | null }) => ref.patientId === 'patient-1',
    )
    const enqueue = await loadRealEnqueue()

    await enqueue({ ...contactEvent, patientId: 'patient-1' })

    expect(isMarketingOptedOutMock).toHaveBeenCalledWith('tenant-1', {
      patientId: 'patient-1',
      phone: '+5511999999999',
    })
    expect(postEventsMock).not.toHaveBeenCalled()
    expect(insertConversionEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'Contact', status: 'skipped', skipReason: 'opted_out' }),
      undefined,
    )
  })
})
