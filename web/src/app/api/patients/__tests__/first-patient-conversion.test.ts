/**
 * Both routes that create a patient schedule FirstPatient, and a Meta failure
 * reaches Sentry without costing the request: the patient is still created.
 * Runs the real scheduler; only the Meta send and the reads behind it are fake.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendFirstPatientEventMock = vi.fn()
const reportSideEffectFailureMock = vi.fn()
const createPatientMock = vi.fn()

const afterTasks: Promise<unknown>[] = []
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => void afterTasks.push(task()),
}))

const CTX = { userId: 'user-1', tenantId: 'tenant-1', role: 'owner', email: 'maria@clinica.com', fullName: 'Maria', isPlatformAdmin: false }
vi.mock('@/lib/auth', () => ({ getAuthContext: async () => CTX }))
vi.mock('@/lib/write-access', () => ({ requireWrite: async () => ({ ctx: CTX, blocked: null }) }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/lib/analytics/server-events', () => ({ trackFirstPatientCreated: vi.fn() }))
vi.mock('@/lib/api-error', () => ({ handleApiError: () => new Response('error', { status: 500 }) }))
vi.mock('@/db/queries/patients', () => ({
  createPatient: (...a: unknown[]) => createPatientMock(...a),
  getPatient: vi.fn(),
  listPatients: vi.fn(),
}))
vi.mock('@/db/queries/tenants', () => ({ getTenant: async () => ({ settings: { whatsapp_enabled: true } }) }))
vi.mock('@/lib/whatsapp-mode', () => ({ isWhatsAppEnabled: () => true }))
vi.mock('@/db/queries/prospects', () => ({
  getProspect: async () => ({ id: 'prospect-1', stage: 'novo' }),
  convertProspect: async () => ({ id: 'prospect-1', stage: 'convertido' }),
  logProspectActivity: vi.fn(),
}))
vi.mock('@/db/queries/whatsapp', () => ({ pushSseEvent: vi.fn() }))

vi.mock('@/db/queries/tenant-firsts', () => ({ isTenantsFirst: async () => true }))
vi.mock('@/db/client', () => {
  const select = () => {
    let joined = false
    const chain = {
      from: () => chain,
      innerJoin: () => ((joined = true), chain),
      where: () => chain,
      orderBy: () => chain,
      limit: async () =>
        joined
          ? [{ email: 'maria@clinica.com' }]
          : [{ phone: '11999998888', signupAttribution: { metaEventId: 'evt-1' }, optedOutAt: null, deletedAt: null }],
    }
    return chain
  }
  return { db: { select } }
})
vi.mock('@/lib/meta/events', () => ({
  sendFirstPatientEvent: (...a: unknown[]) => sendFirstPatientEventMock(...a),
  sendSubscribeEvent: vi.fn(),
}))
vi.mock('@/lib/observability', () => ({
  reportSideEffectFailure: (...a: unknown[]) => reportSideEffectFailureMock(...a),
}))

import { POST as createPatientRoute } from '../route'
import { POST as convertProspectRoute } from '../../crm/prospects/[id]/convert/route'

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'user-agent': 'Clinic Browser' },
  })
}

const ROUTES = [
  ['POST /api/patients', () => createPatientRoute(jsonRequest('http://localhost/api/patients', { fullName: 'Ana Souza', phone: '11988887777' }))],
  ['prospect convert with a new patient', () =>
    convertProspectRoute(
      jsonRequest('http://localhost/api/crm/prospects/prospect-1/convert', { createPatient: { fullName: 'Ana Souza', phone: '11988887777' } }),
      { params: Promise.resolve({ id: 'prospect-1' }) },
    )],
] as const

describe('FirstPatient from the patient creation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    afterTasks.length = 0
    createPatientMock.mockResolvedValue({ id: 'patient-1', fullName: 'Ana Souza' })
    sendFirstPatientEventMock.mockResolvedValue(true)
  })

  it.each(ROUTES)('%s schedules FirstPatient for the clinic', async (_label, call) => {
    const response = await call()
    await Promise.all(afterTasks.splice(0))

    expect(response.status).toBe(200)
    expect(sendFirstPatientEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'first_patient:tenant-1', userAgent: 'Clinic Browser' }),
    )
  })
})
