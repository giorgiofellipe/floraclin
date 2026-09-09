import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: vi.fn() }
})

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
}))

vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn(),
}))

vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(),
  updateTenantSettings: vi.fn(),
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
import { requireWrite } from '@/lib/write-access'
import { getTenant } from '@/db/queries/tenants'
import { listTemplates, updateLocalTemplate, createLocalTemplate } from '@/db/queries/whatsapp'
import { getTemplate as getMetaTemplate, createTemplate as createMetaTemplate } from '@/lib/whatsapp'
import { GET, POST } from '../route'

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
  vi.mocked(requireWrite).mockResolvedValue({
    ctx: { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' },
    blocked: null,
  } as ReturnType<typeof requireWrite> extends Promise<infer T> ? T : never)
})

// Next.js always passes the Request to a route handler; the route reads it
// so a failure can be reported with its route and method.
const makeRequest = () => new Request('https://app.floraclin.com.br/api/whatsapp/templates')

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

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(getMetaTemplate).toHaveBeenCalledWith('tenant-1', 'meta-1')
    expect(updateLocalTemplate).toHaveBeenCalledWith(
      'tenant-1',
      'tpl-1',
      expect.objectContaining({ status: 'APPROVED' }),
    )
    expect(body.data[0].status).toBe('APPROVED')
  })

  it('refreshes each pending row exactly once and stops at the cap', async () => {
    const pending = Array.from({ length: 12 }, (_, i) =>
      template({ id: `tpl-${i}`, metaTemplateId: `meta-${i}` }),
    )
    vi.mocked(listTemplates).mockResolvedValue(pending as never)
    vi.mocked(getMetaTemplate).mockResolvedValue({
      id: 'meta-x',
      name: 'x',
      status: 'APPROVED',
      rejected_reason: null,
    } as never)

    await GET(makeRequest())

    // 12 pending rows, capped at 10, one Meta call each and no duplicates.
    expect(getMetaTemplate).toHaveBeenCalledTimes(10)
    const requestedIds = vi.mocked(getMetaTemplate).mock.calls.map(([, id]) => id)
    expect(new Set(requestedIds).size).toBe(10)
  })

  it('leaves a pending row alone when it has no Meta id yet', async () => {
    vi.mocked(listTemplates).mockResolvedValue([
      template({ metaTemplateId: null }),
    ] as never)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(getMetaTemplate).not.toHaveBeenCalled()
    expect(body.data[0].status).toBe('PENDING')
  })

  it('does not call Meta when every template is already approved', async () => {
    vi.mocked(listTemplates).mockResolvedValue([
      template({ status: 'APPROVED' }),
    ] as never)

    await GET(makeRequest())

    expect(getMetaTemplate).not.toHaveBeenCalled()
    expect(updateLocalTemplate).not.toHaveBeenCalled()
  })

  it('keeps the local status when Meta is unreachable', async () => {
    vi.mocked(listTemplates).mockResolvedValue([template()] as never)
    vi.mocked(getMetaTemplate).mockRejectedValue(new Error('Meta API error'))

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(updateLocalTemplate).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(body.data[0].status).toBe('PENDING')
  })
})

describe('POST /api/whatsapp/templates', () => {
  const body = {
    name: 'lembrete_consulta',
    category: 'UTILITY',
    language: 'pt_BR',
    components: [{ type: 'BODY', text: 'Olá! Tudo certo por aí?' }],
  }

  function request() {
    return new Request('http://localhost/api/whatsapp/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('refuses to create a template for a clinic on the shared FloraClin number', async () => {
    vi.mocked(getTenant).mockResolvedValue({
      id: 'tenant-1',
      name: 'Clínica Flora',
      settings: { whatsapp_mode: 'floraclin' },
    } as never)

    const res = await POST(request())

    expect(res.status).toBe(403)
    expect(createMetaTemplate).not.toHaveBeenCalled()
  })

  it('names a custom template with the tenant prefix so it stays visible to listTemplates', async () => {
    vi.mocked(getTenant).mockResolvedValue({
      id: 'tenant-1',
      name: 'Clínica Flora',
      settings: {
        whatsapp_mode: 'own',
        whatsapp_enabled: true,
        whatsapp_template_prefix: 'clinica_flora',
      },
    } as never)
    vi.mocked(createMetaTemplate).mockResolvedValue({ id: 'meta-9', status: 'PENDING' } as never)
    vi.mocked(createLocalTemplate).mockResolvedValue({ id: 'tpl-9' } as never)

    await POST(request())

    expect(createMetaTemplate).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ name: 'clinica_flora_lembrete_consulta' }),
    )
    expect(createLocalTemplate).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ name: 'clinica_flora_lembrete_consulta' }),
    )
  })

  it('does not double the prefix when the name already carries it', async () => {
    vi.mocked(getTenant).mockResolvedValue({
      id: 'tenant-1',
      name: 'Clínica Flora',
      settings: {
        whatsapp_mode: 'own',
        whatsapp_enabled: true,
        whatsapp_template_prefix: 'clinica_flora',
      },
    } as never)
    vi.mocked(createMetaTemplate).mockResolvedValue({ id: 'meta-9', status: 'PENDING' } as never)
    vi.mocked(createLocalTemplate).mockResolvedValue({ id: 'tpl-9' } as never)

    const res = await new Request('http://localhost/api/whatsapp/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, name: 'clinica_flora_lembrete_consulta' }),
    })
    await POST(res)

    expect(createMetaTemplate).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ name: 'clinica_flora_lembrete_consulta' }),
    )
  })
})
