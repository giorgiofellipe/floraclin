import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/write-access', () => ({ requireWrite: vi.fn() }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/db/queries/anamnesis-templates', () => ({
  getCurrentAnamnesisTemplate: vi.fn(),
  saveAnamnesisTemplate: vi.fn(),
}))

import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { saveAnamnesisTemplate } from '@/db/queries/anamnesis-templates'
import { DEFAULT_ANAMNESIS_TEMPLATE } from '@/lib/anamnesis/default-template'
import type { FormQuestion, FormSection } from '@/lib/forms/types'
import { POST } from '../route'

const TENANT = 'tenant-1'

function asOwner() {
  vi.mocked(requireWrite).mockResolvedValue({
    ctx: { tenantId: TENANT, userId: 'user-1', role: 'owner' },
    blocked: null,
  } as Awaited<ReturnType<typeof requireWrite>>)
}

function post(body: unknown) {
  return POST(new Request('http://localhost/api/anamnesis/template', { method: 'POST', body: JSON.stringify(body) }))
}

function sectionWith(question: Partial<FormQuestion>): FormSection {
  return {
    id: 's1',
    title: 'Geral',
    order: 0,
    questions: [{ id: 'q1', label: 'Pergunta', type: 'text', required: false, order: 0, ...question }],
  }
}

const PREVIOUS = { version: 2, sections: [sectionWith({})] }

beforeEach(() => {
  vi.clearAllMocks()
  asOwner()
})

describe('POST /api/anamnesis/template', () => {
  it('asks for the owner role and returns the blocked response untouched', async () => {
    // Regression: practitioners editing the clinic-wide template.
    const forbidden = NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    vi.mocked(requireWrite).mockResolvedValue({ ctx: null, blocked: forbidden } as never)

    const res = await post({ action: 'reset' })

    expect(requireWrite).toHaveBeenCalledWith('owner')
    expect(res.status).toBe(403)
    expect(saveAnamnesisTemplate).not.toHaveBeenCalled()
  })

  it('rejects a face_diagram question with 400 and saves nothing', async () => {
    const res = await post({ action: 'update', sections: [sectionWith({ type: 'face_diagram' })] })

    expect(res.status).toBe(400)
    expect(saveAnamnesisTemplate).not.toHaveBeenCalled()
  })

  it('reset saves the default sections and audits sections and versions', async () => {
    const template = { version: 3, sections: DEFAULT_ANAMNESIS_TEMPLATE.sections }
    vi.mocked(saveAnamnesisTemplate).mockResolvedValue({ changed: true, id: 'tpl-1', previous: PREVIOUS, template })

    const res = await post({ action: 'reset' })

    expect(saveAnamnesisTemplate).toHaveBeenCalledWith(TENANT, DEFAULT_ANAMNESIS_TEMPLATE.sections)
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        entityType: 'anamnesis_template',
        entityId: 'tpl-1',
        changes: {
          sections: { old: PREVIOUS.sections, new: template.sections },
          version: { old: 2, new: 3 },
        },
      }),
    )
    expect(await res.json()).toEqual({ success: true, data: template })
  })

  it('writes no audit entry when the save changed nothing', async () => {
    // Regression: no-op saves flooding the template history.
    vi.mocked(saveAnamnesisTemplate).mockResolvedValue({ changed: false, template: PREVIOUS })

    const res = await post({ action: 'update', sections: PREVIOUS.sections })

    expect(res.status).toBe(200)
    expect(createAuditLog).not.toHaveBeenCalled()
  })
})
