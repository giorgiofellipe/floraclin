import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [{ userId: 'owner-1' }]),
        })),
      })),
    })),
  },
}))

vi.mock('@/db/schema', () => ({
  tenantUsers: { tenantId: 'tenant_id', userId: 'user_id', role: 'role' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
}))

vi.mock('@/db/queries/anamnesis', () => ({
  getAnamnesis: vi.fn(),
}))

vi.mock('@/db/queries/anamnesis-tokens', () => ({
  createAnamnesisToken: vi.fn(),
}))

vi.mock('@/db/queries/patients', () => ({
  getPatient: vi.fn(),
}))

vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(),
}))

vi.mock('@/db/queries/whatsapp', () => ({
  createMessage: vi.fn(),
  hasOutboundTemplateMessageForPatientOnDay: vi.fn(),
  listAutomations: vi.fn(),
  pushSseEvent: vi.fn(),
  upsertConversation: vi.fn(),
}))

vi.mock('@/lib/whatsapp', () => ({
  getTemplateForTenant: vi.fn(),
  sendTemplateMessage: vi.fn(),
}))

import { getAnamnesis } from '@/db/queries/anamnesis'
import { createAnamnesisToken } from '@/db/queries/anamnesis-tokens'
import {
  hasOutboundTemplateMessageForPatientOnDay,
  listAutomations,
} from '@/db/queries/whatsapp'
import { getTemplateForTenant, sendTemplateMessage } from '@/lib/whatsapp'
import { maybeAutoSendAnamnesisLink } from '../whatsapp-anamnesis'

const AUTOMATION = {
  trigger: 'appointment_confirmation',
  enabled: true,
  config: { autoAnamnesisEnabled: true, anamnesisStaleDays: 60 },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listAutomations).mockResolvedValue([AUTOMATION] as never)
  vi.mocked(getAnamnesis).mockResolvedValue(null as never)
  vi.mocked(getTemplateForTenant).mockResolvedValue({
    name: 'anamnese_link_v1',
    status: 'APPROVED',
    language: 'pt_BR',
  } as never)
  vi.mocked(hasOutboundTemplateMessageForPatientOnDay).mockResolvedValue(false)
})

describe('maybeAutoSendAnamnesisLink', () => {
  it('skips when an anamnesis link was already sent for that patient/template/day', async () => {
    vi.mocked(hasOutboundTemplateMessageForPatientOnDay).mockResolvedValue(true)

    const result = await maybeAutoSendAnamnesisLink({
      tenantId: 'tenant-1',
      patientId: 'patient-1',
      phone: '5511999990000',
      dedupeDateYmd: '2026-10-13',
    })

    expect(result).toEqual({ status: 'skipped', reason: 'already_sent' })
    expect(hasOutboundTemplateMessageForPatientOnDay).toHaveBeenCalledWith(
      'tenant-1',
      'patient-1',
      'anamnese_link_v1',
      '2026-10-13',
    )
    expect(createAnamnesisToken).not.toHaveBeenCalled()
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('keeps the existing stale-anamnesis dedupe before checking templates', async () => {
    vi.mocked(getAnamnesis).mockResolvedValue({
      updatedAt: new Date().toISOString(),
    } as never)

    const result = await maybeAutoSendAnamnesisLink({
      tenantId: 'tenant-1',
      patientId: 'patient-1',
      phone: '5511999990000',
      dedupeDateYmd: '2026-10-13',
    })

    expect(result).toEqual({ status: 'skipped', reason: 'fresh_anamnesis' })
    expect(getTemplateForTenant).not.toHaveBeenCalled()
    expect(hasOutboundTemplateMessageForPatientOnDay).not.toHaveBeenCalled()
  })
})
