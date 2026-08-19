import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: vi.fn() }
})

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
}))

vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(),
}))

vi.mock('@/db/queries/whatsapp', () => ({
  listTemplates: vi.fn(),
  createLocalTemplate: vi.fn(),
  updateLocalTemplate: vi.fn(),
}))

vi.mock('@/lib/whatsapp', async () => {
  const actual = await vi.importActual<typeof import('@/lib/whatsapp')>('@/lib/whatsapp')
  return {
    ...actual,
    createTemplate: vi.fn(),
    getTemplate: vi.fn(),
    syncTemplatesForTenant: vi.fn(),
  }
})

import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { listTemplates, updateLocalTemplate } from '@/db/queries/whatsapp'
import { getTemplate as getMetaTemplate } from '@/lib/whatsapp'
import { GET } from '../route'

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tpl-1',
    tenantId: 'tenant-1',
    metaTemplateId: 'meta-1',
    name: 'clinica_flora_confirm_appointment',
    language: 'pt_BR',
    category: 'UTILITY',
    status: 'PENDING',
    components: [],
    purposeKey: 'appointment_confirmation',
    rejectedReason: null,
    blueprintSlug: null,
    submittedAt: null,
    variableMapping: null,
    systemTemplate: false,
    syncedAt: new Date(),
    createdAt: new Date(),
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
    settings: { whatsapp_mode: 'own', whatsapp_enabled: true },
  } as never)
})

describe('GET /api/whatsapp/templates', () => {
  it('refreshes a PENDING template from Meta before responding', async () => {
    vi.mocked(listTemplates)
      .mockResolvedValueOnce([template()] as never)
      .mockResolvedValueOnce([template({ status: 'APPROVED' })] as never)
    vi.mocked(getMetaTemplate).mockResolvedValue({
      id: 'meta-1',
      name: 'clinica_flora_confirm_appointment',
      status: 'APPROVED',
      rejected_reason: null,
    } as never)

    const res = await GET()
    const body = await res.json()

    expect(getMetaTemplate).toHaveBeenCalledWith('tenant-1', 'meta-1')
    expect(updateLocalTemplate).toHaveBeenCalledWith(
      'tenant-1',
      'tpl-1',
      expect.objectContaining({ status: 'APPROVED' }),
    )
    expect(body.data[0].status).toBe('APPROVED')
  })

  it('does not call Meta when every template is already approved', async () => {
    vi.mocked(listTemplates).mockResolvedValue([
      template({ status: 'APPROVED' }),
    ] as never)

    await GET()

    expect(getMetaTemplate).not.toHaveBeenCalled()
    expect(updateLocalTemplate).not.toHaveBeenCalled()
  })

  it('keeps the local status when Meta is unreachable', async () => {
    vi.mocked(listTemplates).mockResolvedValue([template()] as never)
    vi.mocked(getMetaTemplate).mockRejectedValue(new Error('Meta API error'))

    const res = await GET()
    const body = await res.json()

    expect(updateLocalTemplate).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(body.data[0].status).toBe('PENDING')
  })
})
