import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/write-access', () => ({ requireWrite: vi.fn() }))
vi.mock('@/db/queries/tenants', () => ({ getTenant: vi.fn() }))
vi.mock('@/db/queries/patients', () => ({ getPatient: vi.fn() }))
vi.mock('@/lib/whatsapp', () => ({ getTemplateForTenant: vi.fn() }))
vi.mock('@/lib/whatsapp-automated-send', () => ({ sendAndRecordTemplate: vi.fn() }))

import { requireWrite } from '@/lib/write-access'
import { getTenant } from '@/db/queries/tenants'
import { getPatient } from '@/db/queries/patients'
import { getTemplateForTenant } from '@/lib/whatsapp'
import { sendAndRecordTemplate } from '@/lib/whatsapp-automated-send'
import { POST } from '../route'

function post(documents: string) {
  return POST(
    new Request('https://app.floraclin.com.br/api/patients/p1/document-request', {
      method: 'POST',
      body: JSON.stringify({ documents }),
    }),
    { params: Promise.resolve({ id: 'p1' }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWrite).mockResolvedValue({ ctx: { tenantId: 't1', userId: 'u1', role: 'owner' }, blocked: null } as never)
  vi.mocked(getTenant).mockResolvedValue({ id: 't1', name: 'Clínica Lume', settings: { whatsapp_enabled: true } } as never)
  vi.mocked(getPatient).mockResolvedValue({ id: 'p1', fullName: 'Maria Silva', phone: '11999991234' } as never)
  vi.mocked(getTemplateForTenant).mockResolvedValue({
    name: 'document_request',
    language: 'pt_BR',
    status: 'APPROVED',
    purposeKey: 'document_request',
    variableMapping: null,
    components: [],
  } as never)
  vi.mocked(sendAndRecordTemplate).mockResolvedValue({ metaMessageId: 'wamid.1' } as never)
})

describe('POST /api/patients/[id]/document-request', () => {
  // Regression: a list typed one document per line reaching Meta as is, which rejects the send.
  it('sends the typed list as one line, charged to the user who asked', async () => {
    const res = await post('RG\nCPF\n\nComprovante de endereço')

    expect(res.status).toBe(201)
    expect(sendAndRecordTemplate).toHaveBeenCalledWith(expect.objectContaining({
      phone: '5511999991234',
      params: { '1': 'Maria', '2': 'Clínica Lume', '3': 'RG. CPF. Comprovante de endereço.' },
      actor: { type: 'user', userId: 'u1' },
    }))
  })

  it('refuses without sending when the template is not approved', async () => {
    vi.mocked(getTemplateForTenant).mockResolvedValue({ status: 'PENDING' } as never)

    const res = await post('RG')

    expect(res.status).toBe(400)
    expect(sendAndRecordTemplate).not.toHaveBeenCalled()
  })
})
