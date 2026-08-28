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

vi.mock('@/db/queries/meta-events', () => ({
  hasScheduleForProspect: vi.fn(),
}))

import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { subscriptionGate } from '@/lib/plans'
import { createProspect, getProspect, logProspectActivity, updateProspect } from '@/db/queries/prospects'
import { enqueueMetaEvent } from '@/lib/meta/events'
import { hasScheduleForProspect } from '@/db/queries/meta-events'
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
  vi.mocked(hasScheduleForProspect).mockResolvedValue(false)
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

  it('moving a lead that already has an appointment-sourced Schedule back into agendado emits nothing', async () => {
    vi.mocked(getProspect).mockResolvedValue(prospect({ stage: 'qualificado' }) as never)
    vi.mocked(updateProspect).mockResolvedValue(prospect({ stage: 'agendado' }) as never)
    vi.mocked(hasScheduleForProspect).mockResolvedValue(true)

    const res = await PATCH(patchRequest({ stage: 'agendado' }), {
      params: Promise.resolve({ id: 'prospect-1' }),
    })
    expect(res.status).toBe(200)

    expect(hasScheduleForProspect).toHaveBeenCalledWith('tenant-1', 'prospect-1')
    expect(enqueueMetaEvent).not.toHaveBeenCalled()
  })

  it('moving a lead with no prior Schedule into agendado emits one Schedule event', async () => {
    vi.mocked(getProspect).mockResolvedValue(prospect({ stage: 'qualificado' }) as never)
    vi.mocked(updateProspect).mockResolvedValue(prospect({ stage: 'agendado' }) as never)
    vi.mocked(hasScheduleForProspect).mockResolvedValue(false)

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
        actionSource: 'system_generated',
        contact: { phone: '+5511999999999', fullName: 'Maria Souza' },
      }),
    )
  })
})
