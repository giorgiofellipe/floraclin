import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendFirstPatientEventMock = vi.fn()
const isTenantsFirstMock = vi.fn()
const reportSideEffectFailureMock = vi.fn()
const tenantRows = vi.fn()
const ownerRows = vi.fn()
const afterMock = vi.fn()

const afterTasks: Array<() => Promise<unknown>> = []
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => afterMock(task),
}))
// The tenant read ends at limit(); the owner read is the only one that joins.
vi.mock('@/db/client', () => {
  const select = () => {
    let joined = false
    const chain = {
      from: () => chain,
      innerJoin: () => ((joined = true), chain),
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(joined ? ownerRows() : tenantRows()),
    }
    return chain
  }
  return { db: { select } }
})
vi.mock('@/db/queries/tenant-firsts', () => ({
  isTenantsFirst: (...a: unknown[]) => isTenantsFirstMock(...a),
}))
vi.mock('@/lib/meta/events', () => ({
  sendFirstPatientEvent: (...a: unknown[]) => sendFirstPatientEventMock(...a),
  sendSubscribeEvent: vi.fn(),
}))
vi.mock('@/lib/observability', () => ({
  reportSideEffectFailure: (...a: unknown[]) => reportSideEffectFailureMock(...a),
}))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://app.floraclin.com.br' }))

import { patients } from '@/db/schema'
import { scheduleFirstPatientConversion } from '../platform-conversions'

const ACTOR = { tenantId: 'tenant-1', isPlatformAdmin: false }
const HEADERS = new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'Clinic Browser' })

const SELF_SIGNUP = {
  phone: '11999998888',
  signupAttribution: {
    metaEventId: 'complete_registration:evt-1',
    fbclid: 'fb-click',
    capturedAt: '2026-10-06T00:00:00.000Z',
    fbp: 'fb.1.1700000000000.browser',
  },
  optedOutAt: null,
  deletedAt: null,
}

async function runAfterTasks() {
  await Promise.all(afterTasks.splice(0).map((task) => task()))
}

describe('scheduleFirstPatientConversion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    afterTasks.length = 0
    afterMock.mockImplementation((task: () => Promise<unknown>) => void afterTasks.push(task))
    isTenantsFirstMock.mockResolvedValue(true)
    tenantRows.mockReturnValue([SELF_SIGNUP])
    ownerRows.mockReturnValue([{ email: 'maria@clinica.com' }])
    sendFirstPatientEventMock.mockResolvedValue(true)
  })

  it("sends FirstPatient for the clinic's first patient with the owner, the signup ad click and the request browser", async () => {
    scheduleFirstPatientConversion(ACTOR, 'patient-1', HEADERS)
    await runAfterTasks()

    expect(isTenantsFirstMock).toHaveBeenCalledWith(patients, 'tenant-1', 'patient-1')
    expect(sendFirstPatientEventMock).toHaveBeenCalledTimes(1)
    expect(sendFirstPatientEventMock).toHaveBeenCalledWith({
      eventId: 'first_patient:tenant-1',
      email: 'maria@clinica.com',
      phone: '11999998888',
      eventSourceUrl: 'https://app.floraclin.com.br/pacientes',
      clientIp: '203.0.113.9',
      userAgent: 'Clinic Browser',
      fbc: 'fb.1.1791244800000.fb-click',
      fbp: 'fb.1.1700000000000.browser',
    })
  })

  // Patient creation must not wait on the first-patient check or the tenant reads.
  it('makes no read before the response, only inside after()', () => {
    scheduleFirstPatientConversion(ACTOR, 'patient-1', HEADERS)

    expect(afterTasks).toHaveLength(1)
    expect(isTenantsFirstMock).not.toHaveBeenCalled()
    expect(tenantRows).not.toHaveBeenCalled()
  })

  it('sends nothing for a patient that is not the clinic first', async () => {
    isTenantsFirstMock.mockResolvedValue(false)

    scheduleFirstPatientConversion(ACTOR, 'patient-2', HEADERS)
    await runAfterTasks()

    expect(sendFirstPatientEventMock).not.toHaveBeenCalled()
  })

  it.each([
    ['opted out of Meta conversion events', { ...SELF_SIGNUP, optedOutAt: new Date('2026-10-20T00:00:00.000Z') }],
    ['deleted', { ...SELF_SIGNUP, deletedAt: new Date('2026-10-20T00:00:00.000Z') }],
    ['created by a platform admin (no signup attribution)', { ...SELF_SIGNUP, signupAttribution: null }],
    ['without a signup conversion id', { ...SELF_SIGNUP, signupAttribution: { fbclid: 'fb-click', capturedAt: '2026-10-06T00:00:00.000Z' } }],
  ])('sends nothing for a clinic %s', async (_label, row) => {
    tenantRows.mockReturnValue([row])

    scheduleFirstPatientConversion(ACTOR, 'patient-1', HEADERS)
    await runAfterTasks()

    expect(sendFirstPatientEventMock).not.toHaveBeenCalled()
  })

  it('sends nothing when the clinic has no active owner to match on', async () => {
    ownerRows.mockReturnValue([])

    scheduleFirstPatientConversion(ACTOR, 'patient-1', HEADERS)
    await runAfterTasks()

    expect(sendFirstPatientEventMock).not.toHaveBeenCalled()
  })

  it('sends nothing for a patient a platform admin created during support', async () => {
    scheduleFirstPatientConversion({ ...ACTOR, isPlatformAdmin: true }, 'patient-1', HEADERS)
    await runAfterTasks()

    expect(afterMock).not.toHaveBeenCalled()
    expect(sendFirstPatientEventMock).not.toHaveBeenCalled()
  })

  it('reports a failure inside the scheduled task instead of letting it escape', async () => {
    const failure = new Error('db down')
    isTenantsFirstMock.mockRejectedValue(failure)

    scheduleFirstPatientConversion(ACTOR, 'patient-1', HEADERS)
    await runAfterTasks()

    expect(reportSideEffectFailureMock).toHaveBeenCalledWith(failure, {
      area: 'meta-capi',
      step: 'first_patient',
      extra: { tenantId: 'tenant-1' },
    })
  })
})
