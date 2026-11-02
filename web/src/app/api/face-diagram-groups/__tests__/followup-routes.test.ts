import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', async () => {
  const { ForbiddenError } = await import('@/lib/errors')
  const getAuthContext = vi.fn()
  return {
    getAuthContext,
    requireRole: async (...roles: string[]) => {
      const ctx = await getAuthContext()
      if (!roles.includes(ctx.role)) throw new ForbiddenError('Forbidden')
      return ctx
    },
  }
})
vi.mock('@/lib/plans', () => ({ subscriptionGate: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/db/client', () => ({ db: {} }))
vi.mock('@/lib/followups', () => ({
  DIAGRAM_NOT_FOUND: 'Diagram group not found',
  DIAGRAM_NOT_AWAITING: 'Diagram quote is not awaiting an answer',
  recordDiagramFollowup: vi.fn(),
  snoozeDiagramGroup: vi.fn(),
}))

import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import {
  DIAGRAM_NOT_AWAITING,
  DIAGRAM_NOT_FOUND,
  recordDiagramFollowup,
  snoozeDiagramGroup,
} from '@/lib/followups'
import { POST } from '../[id]/followups/route'
import { PATCH } from '../[id]/snooze/route'

const params = { params: Promise.resolve({ id: 'g1' }) }
const req = (method: string, body: unknown) =>
  new Request('http://test', { method, body: JSON.stringify(body) })
const followupBody = { channel: 'whatsapp', outcome: 'sem_resposta' }
const snoozeBody = { until: '2099-01-01' }

function as(role: string) {
  vi.mocked(getAuthContext).mockResolvedValue({ tenantId: 'tenant-1', userId: 'u1', role } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  as('owner')
})

describe('quote follow-up routes', () => {
  it.each([
    ['followups', () => POST(req('POST', followupBody), params), recordDiagramFollowup],
    ['snooze', () => PATCH(req('PATCH', snoozeBody), params), snoozeDiagramGroup],
  ])('%s rejects a financial role with 403 before touching the quote', async (_n, call, service) => {
    as('financial')
    const res = await call()
    expect(res.status).toBe(403)
    expect(service).not.toHaveBeenCalled()
  })

  it.each([
    ['followups', () => POST(req('POST', followupBody), params), recordDiagramFollowup],
    ['snooze', () => PATCH(req('PATCH', snoozeBody), params), snoozeDiagramGroup],
  ])('%s maps a quote no longer awaiting to 409 without auditing', async (_n, call, service) => {
    (service as ReturnType<typeof vi.fn>).mockRejectedValue(new Error(DIAGRAM_NOT_AWAITING))
    const res = await call()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Este orçamento não está mais aguardando' })
    expect(createAuditLog).not.toHaveBeenCalled()
  })

  it.each([
    ['followups', () => POST(req('POST', followupBody), params), recordDiagramFollowup],
    ['snooze', () => PATCH(req('PATCH', snoozeBody), params), snoozeDiagramGroup],
  ])('%s maps a missing quote to 404 without auditing', async (_n, call, service) => {
    (service as ReturnType<typeof vi.fn>).mockRejectedValue(new Error(DIAGRAM_NOT_FOUND))
    const res = await call()
    expect(res.status).toBe(404)
    expect(createAuditLog).not.toHaveBeenCalled()
  })
})
