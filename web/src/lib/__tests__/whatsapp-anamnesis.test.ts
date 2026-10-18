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
  deleteAnamnesisToken: vi.fn(async () => undefined),
  hasAnamnesisTokenCreatedOnBrDay: vi.fn(),
}))

vi.mock('@/db/queries/patients', () => ({
  getPatient: vi.fn(),
}))

vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(),
}))

vi.mock('@/db/queries/whatsapp', () => ({
  createMessage: vi.fn(),
  listAutomations: vi.fn(),
  pushSseEvent: vi.fn(),
  upsertConversation: vi.fn(),
}))

vi.mock('@/lib/whatsapp', () => ({
  getTemplateForTenant: vi.fn(),
  sendTemplateMessage: vi.fn(),
  resolveTemplateBody: vi.fn(),
}))

import { getAnamnesis } from '@/db/queries/anamnesis'
import { createAnamnesisToken, deleteAnamnesisToken, hasAnamnesisTokenCreatedOnBrDay } from '@/db/queries/anamnesis-tokens'
import { getPatient } from '@/db/queries/patients'
import { getTenant } from '@/db/queries/tenants'
import { createMessage, listAutomations, upsertConversation } from '@/db/queries/whatsapp'
import { brToday } from '@/lib/dates'
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
  vi.mocked(hasAnamnesisTokenCreatedOnBrDay).mockResolvedValue(false)
})

describe('maybeAutoSendAnamnesisLink', () => {
  // Regression: the cron and the confirm-reply webhook both sent a link to the same patient on one day.
  it('skips when a link token was already created for the patient today', async () => {
    vi.mocked(hasAnamnesisTokenCreatedOnBrDay).mockResolvedValue(true)

    const result = await maybeAutoSendAnamnesisLink({
      tenantId: 'tenant-1',
      patientId: 'patient-1',
      phone: '5511999990000',
    })

    expect(result).toEqual({ status: 'skipped', reason: 'already_sent' })
    expect(hasAnamnesisTokenCreatedOnBrDay).toHaveBeenCalledWith('tenant-1', 'patient-1', brToday())
    expect(createAnamnesisToken).not.toHaveBeenCalled()
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  // Regression: the cron link used the 2h default and was dead before the patient opened it.
  it('creates the token with the expiry the caller passes', async () => {
    const linkExpiresAt = new Date('2026-10-13T17:00:00.000Z')
    vi.mocked(getPatient).mockResolvedValue({ fullName: 'Maria Silva' } as never)
    vi.mocked(getTenant).mockResolvedValue({ name: 'Flora' } as never)
    vi.mocked(createAnamnesisToken).mockResolvedValue({ token: 'tok-1' } as never)
    vi.mocked(sendTemplateMessage).mockResolvedValue({ metaMessageId: 'wamid.1' } as never)
    vi.mocked(upsertConversation).mockResolvedValue({ id: 'conv-1' } as never)
    vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1' } as never)

    const result = await maybeAutoSendAnamnesisLink({
      tenantId: 'tenant-1',
      patientId: 'patient-1',
      phone: '5511999990000',
      linkExpiresAt,
    })

    expect(result).toEqual({ status: 'sent', metaMessageId: 'wamid.1' })
    expect(createAnamnesisToken).toHaveBeenCalledWith('tenant-1', 'patient-1', 'owner-1', linkExpiresAt)
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      'tenant-1',
      { actor: { type: 'system' }, recipient: { patientId: 'patient-1', name: 'Maria Silva' } },
      '5511999990000',
      'anamnese_link_v1',
      'pt_BR',
      expect.any(Object),
      expect.any(Array),
    )
  })

  // Regression: the link send hardcoded {1: name, 2: clinic}, so a clinic that
  // reordered its template variables got the values swapped.
  it('fills the params from the template variable mapping', async () => {
    vi.mocked(getTemplateForTenant).mockResolvedValue({
      name: 'anamnese_link_v1',
      status: 'APPROVED',
      language: 'pt_BR',
      purposeKey: 'anamnese_link',
      components: [],
      variableMapping: [
        { index: 1, key: 'clinic_name', label: 'Clínica', example: 'Clínica Flora' },
        { index: 2, key: 'patient_name', label: 'Nome', example: 'Maria' },
      ],
    } as never)
    vi.mocked(getPatient).mockResolvedValue({ fullName: 'Maria Silva' } as never)
    vi.mocked(getTenant).mockResolvedValue({ name: 'Flora' } as never)
    vi.mocked(createAnamnesisToken).mockResolvedValue({ token: 'tok-1' } as never)
    vi.mocked(sendTemplateMessage).mockResolvedValue({ metaMessageId: 'wamid.1' } as never)

    await maybeAutoSendAnamnesisLink({ tenantId: 'tenant-1', patientId: 'patient-1', phone: '5511999990000' })

    expect(vi.mocked(sendTemplateMessage).mock.calls[0][5]).toEqual({ '1': 'Flora', '2': 'Maria' })
  })

  // Regression: an unsent link left its token behind, so the day read as already sent.
  it('deletes the token when the send fails', async () => {
    const sendError = new Error('Meta API error: paused')
    vi.mocked(getPatient).mockResolvedValue({ fullName: 'Maria Silva' } as never)
    vi.mocked(getTenant).mockResolvedValue({ name: 'Flora' } as never)
    vi.mocked(createAnamnesisToken).mockResolvedValue({ id: 'token-1', token: 'tok-1' } as never)
    vi.mocked(sendTemplateMessage).mockRejectedValue(sendError)

    await expect(
      maybeAutoSendAnamnesisLink({ tenantId: 'tenant-1', patientId: 'patient-1', phone: '5511999990000' }),
    ).rejects.toBe(sendError)

    expect(deleteAnamnesisToken).toHaveBeenCalledWith('tenant-1', 'token-1')
  })
})
