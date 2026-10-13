import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/write-access', () => ({ requireWrite: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/db/queries/evaluation-templates', () => ({
  getTemplatesForProcedureTypes: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  resetTemplateToDefault: vi.fn(),
}))

import { requireWrite } from '@/lib/write-access'
import { createTemplate, updateTemplate } from '@/db/queries/evaluation-templates'
import { POST } from '../route'

const validSections = [
  {
    id: 's1',
    title: 'Avaliação',
    order: 0,
    questions: [{ id: 'q1', label: 'Queixa', type: 'text', required: false, order: 0 }],
  },
]

const radioWithOneOption = [
  {
    id: 's1',
    title: 'Avaliação',
    order: 0,
    questions: [{ id: 'q1', label: 'Pele', type: 'radio', required: false, order: 0, options: ['Seca'] }],
  },
]

function post(body: unknown) {
  return POST(new Request('http://localhost/api/evaluation/templates', { method: 'POST', body: JSON.stringify(body) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWrite).mockResolvedValue({
    ctx: { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' },
    blocked: null,
  } as Awaited<ReturnType<typeof requireWrite>>)
  vi.mocked(createTemplate).mockResolvedValue({ id: 't1' } as Awaited<ReturnType<typeof createTemplate>>)
})

describe('POST /api/evaluation/templates', () => {
  it('rejects an update with a radio question that has one option and does not save it', async () => {
    const res = await post({ action: 'update', templateId: 't1', sections: radioWithOneOption })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/^Dados inválidos: /)
    expect(updateTemplate).not.toHaveBeenCalled()
  })

  it('rejects a create with invalid sections and does not save it', async () => {
    const res = await post({ action: 'create', procedureTypeId: 'p1', name: 'Ficha', sections: radioWithOneOption })

    expect(res.status).toBe(400)
    expect(createTemplate).not.toHaveBeenCalled()
  })

  it('saves valid sections on update', async () => {
    const res = await post({ action: 'update', templateId: 't1', sections: validSections })

    expect(res.status).toBe(200)
    expect(updateTemplate).toHaveBeenCalledWith('tenant-1', 't1', validSections)
  })
})
