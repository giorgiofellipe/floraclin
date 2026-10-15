import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
  requireRole: vi.fn(),
}))

vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(),
}))

vi.mock('@/lib/plans', () => ({
  subscriptionGate: vi.fn(),
}))

vi.mock('@/db/queries/prospects', () => ({
  getProspect: vi.fn(),
}))

import { getAuthContext, requireRole } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { subscriptionGate } from '@/lib/plans'
import { getProspect } from '@/db/queries/prospects'
import { GET as listRoute, POST as createRoute } from '../route'
import { GET as getRoute } from '../[id]/route'
import { POST as convertRoute } from '../[id]/convert/route'

const BASE = 'https://app.floraclin.com.br/api/crm/prospects'
const params = { params: Promise.resolve({ id: 'prospect-1' }) }

// Each call stops right after the WhatsApp gate with its own status, so a
// 403 can only come from the gate.
const ROUTES = [
  ['GET list', () => listRoute(new Request(`${BASE}?stage=bogus`)), 400],
  ['POST create', () => createRoute(new Request(BASE, { method: 'POST', body: '{}' })), 400],
  ['GET one', () => getRoute(new Request(`${BASE}/prospect-1`), params), 404],
  ['POST convert', () => convertRoute(new Request(`${BASE}/prospect-1/convert`, { method: 'POST', body: '{}' }), params), 404],
] as const

function withSettings(settings: Record<string, unknown>) {
  vi.mocked(getTenant).mockResolvedValue({ id: 'tenant-1', name: 'Clínica', settings } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  const ctx = { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' }
  vi.mocked(getAuthContext).mockResolvedValue(ctx as never)
  vi.mocked(requireRole).mockResolvedValue(ctx as never)
  vi.mocked(subscriptionGate).mockResolvedValue(null)
  vi.mocked(getProspect).mockResolvedValue(null as never)
})

describe('CRM prospects WhatsApp gate', () => {
  it.each(ROUTES)('%s lets a shared-number clinic without the whatsapp_enabled flag through', async (_name, call, status) => {
    withSettings({})

    const res = await call()

    expect(res.status).toBe(status)
  })

  it.each(ROUTES)('%s refuses an own-number clinic that has not enabled WhatsApp', async (_name, call) => {
    withSettings({ whatsapp_mode: 'own' })

    const res = await call()

    expect(res.status).toBe(403)
  })
})
