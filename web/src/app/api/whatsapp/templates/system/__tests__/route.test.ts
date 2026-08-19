import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
}))

vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(),
}))

vi.mock('@/db/queries/whatsapp', () => ({
  listSystemTemplates: vi.fn(),
}))

import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { listSystemTemplates } from '@/db/queries/whatsapp'
import { GET } from '../route'

const SYSTEM_ROW = {
  id: 'sys-1',
  name: 'clinica_floraclin_confirm_appointment',
  language: 'pt_BR',
  purposeKey: 'appointment_confirmation',
  status: 'APPROVED',
  components: [],
  variableMapping: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'owner',
  } as never)
  vi.mocked(listSystemTemplates).mockResolvedValue([SYSTEM_ROW] as never)
})

// Next.js always passes the Request to a route handler; the route reads it
// so a failure can be reported with its route and method.
const makeRequest = () =>
  new Request('https://app.floraclin.com.br/api/whatsapp/templates/system')

describe('GET /api/whatsapp/templates/system', () => {
  it('returns the platform templates and the clinic name that fills clinic_name', async () => {
    vi.mocked(getTenant).mockResolvedValue({
      id: 'tenant-1',
      name: 'Dra. Micaela Floriani',
      settings: { whatsapp_mode: 'floraclin' },
    } as never)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.clinicName).toBe('Dra. Micaela Floriani')
    expect(body.data).toEqual([SYSTEM_ROW])
  })

  it('refuses a role the clinic did not allow on WhatsApp', async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-2',
      role: 'receptionist',
    } as never)
    vi.mocked(getTenant).mockResolvedValue({
      id: 'tenant-1',
      name: 'Dra. Micaela Floriani',
      settings: { whatsapp_mode: 'floraclin', whatsapp_allowed_roles: ['owner'] },
    } as never)

    const res = await GET(makeRequest())

    expect(res.status).toBe(403)
    expect(listSystemTemplates).not.toHaveBeenCalled()
  })

  it('refuses an own-number clinic that has not enabled WhatsApp', async () => {
    vi.mocked(getTenant).mockResolvedValue({
      id: 'tenant-1',
      name: 'Clínica Flora',
      settings: { whatsapp_mode: 'own', whatsapp_enabled: false },
    } as never)

    const res = await GET(makeRequest())

    expect(res.status).toBe(400)
    expect(listSystemTemplates).not.toHaveBeenCalled()
  })
})
