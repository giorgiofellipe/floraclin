import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
  requireRole: vi.fn(),
}))

vi.mock('@/lib/plans', () => ({
  subscriptionGate: vi.fn(),
}))

vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(),
}))

vi.mock('@/db/queries/whatsapp', () => ({
  getConversation: vi.fn(),
  getMessage: vi.fn(),
  upsertConversation: vi.fn(),
  createMessage: vi.fn(),
  pushSseEvent: vi.fn(),
  getTemplateByName: vi.fn(),
}))

vi.mock('@/db/queries/appointments', () => ({
  getAppointmentByConfirmationMessageId: vi.fn(),
  updateConfirmationMessageId: vi.fn(),
}))

vi.mock('@/lib/whatsapp', () => ({
  sendTemplateMessage: vi.fn(),
  resolveTemplateBody: vi.fn(),
  isWhatsAppEnabled: vi.fn(() => true),
  getTemplateForTenant: vi.fn(),
}))

import { getAuthContext, requireRole } from '@/lib/auth'
import { subscriptionGate } from '@/lib/plans'
import { getTenant } from '@/db/queries/tenants'
import {
  createMessage,
  getConversation,
  getMessage,
  getTemplateByName,
  pushSseEvent,
  upsertConversation,
} from '@/db/queries/whatsapp'
import { getAppointmentByConfirmationMessageId, updateConfirmationMessageId } from '@/db/queries/appointments'
import { resolveTemplateBody, sendTemplateMessage } from '@/lib/whatsapp'
import { POST } from '../route'

const AUTH_CTX = { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' }

function request() {
  return new Request('https://app.floraclin.com.br/api/whatsapp/conversations/conv-1/messages/msg-1/retry', {
    method: 'POST',
  })
}

function params() {
  return { params: Promise.resolve({ id: 'conv-1', messageId: 'msg-1' }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue(AUTH_CTX as never)
  vi.mocked(requireRole).mockResolvedValue(AUTH_CTX as never)
  vi.mocked(subscriptionGate).mockResolvedValue(null)
  vi.mocked(getTenant).mockResolvedValue({
    id: 'tenant-1',
    name: 'Flora Clinic',
    settings: { whatsapp_mode: 'own', whatsapp_enabled: true },
  } as never)
  vi.mocked(getConversation).mockResolvedValue({ id: 'conv-1' } as never)
  vi.mocked(getMessage).mockResolvedValue({
    id: 'msg-1',
    direction: 'outbound',
    deliveryStatus: 'failed',
    metaMessageId: 'wamid.old',
    templateName: 'appointment_confirmation_v1',
  } as never)
  vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
    id: 'appt-1',
    patientId: 'patient-1',
    patientName: 'Maria Silva',
    patientPhone: '04147988443635',
    bookingName: null,
    bookingPhone: null,
    date: '2026-06-02',
    startTime: '14:30:00',
  } as never)
  vi.mocked(getTemplateByName).mockResolvedValue({
    name: 'appointment_confirmation_v1',
    language: 'pt_BR',
    status: 'APPROVED',
    components: [],
  } as never)
  vi.mocked(sendTemplateMessage).mockResolvedValue({ metaMessageId: 'wamid.new' } as never)
  vi.mocked(upsertConversation).mockResolvedValue({ id: 'conv-current' } as never)
  vi.mocked(resolveTemplateBody).mockReturnValue('Olá Maria' as never)
  vi.mocked(createMessage).mockResolvedValue({ id: 'msg-new', conversationId: 'conv-current' } as never)
})

describe('POST /api/whatsapp/conversations/[id]/messages/[messageId]/retry', () => {
  it('resends an appointment confirmation to the current patient phone and relinks the appointment', async () => {
    const res = await POST(request(), params())

    expect(res!.status).toBe(201)
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      'tenant-1',
      '5547988443635',
      'appointment_confirmation_v1',
      'pt_BR',
      {
        '1': 'Maria',
        '2': 'Flora Clinic',
        '3': '02/06/2026',
        '4': '14:30',
      },
    )
    expect(updateConfirmationMessageId).toHaveBeenCalledWith('tenant-1', 'appt-1', 'wamid.new')
    expect(upsertConversation).toHaveBeenCalledWith('tenant-1', '5547988443635', 'Maria Silva', undefined, 'patient-1')
    expect(createMessage).toHaveBeenCalledWith(
      'tenant-1',
      'conv-current',
      expect.objectContaining({
        direction: 'outbound',
        metaMessageId: 'wamid.new',
        templateName: 'appointment_confirmation_v1',
        deliveryStatus: 'sent',
      }),
    )
    expect(pushSseEvent).toHaveBeenCalledWith('tenant-1', 'new_message', {
      conversationId: 'conv-current',
      message: { id: 'msg-new', conversationId: 'conv-current' },
    })
  })
})
