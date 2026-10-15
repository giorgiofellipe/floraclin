import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
}))

vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn(),
}))

vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(),
}))

vi.mock('@/db/queries/whatsapp', () => ({
  claimFailedMessageForRetry: vi.fn(),
  releaseRetryClaim: vi.fn(),
  upsertConversation: vi.fn(),
  createMessage: vi.fn(),
  pushSseEvent: vi.fn(),
}))

vi.mock('@/db/queries/appointments', () => ({
  getAppointmentByConfirmationMessageId: vi.fn(),
  relinkConfirmationMessageId: vi.fn(),
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

vi.mock('@/lib/whatsapp', async () => {
  const actual = await vi.importActual<typeof import('@/lib/whatsapp')>('@/lib/whatsapp')
  return {
    sendTemplateMessage: vi.fn(),
    resolveTemplateBody: vi.fn(),
    getTemplateForTenant: vi.fn(),
  }
})

import * as Sentry from '@sentry/nextjs'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { getTenant } from '@/db/queries/tenants'
import {
  claimFailedMessageForRetry,
  createMessage,
  pushSseEvent,
  releaseRetryClaim,
  upsertConversation,
} from '@/db/queries/whatsapp'
import { getAppointmentByConfirmationMessageId, relinkConfirmationMessageId } from '@/db/queries/appointments'
import { CreditExhaustedError } from '@/lib/whatsapp-credits'
import {
  getTemplateForTenant,
  resolveTemplateBody,
  sendTemplateMessage,
} from '@/lib/whatsapp'
import { POST } from '../route'

const AUTH_CTX = { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' }

const APPOINTMENT = {
  id: 'appt-1',
  patientId: 'patient-1',
  patientName: 'Maria Silva',
  patientPhone: '47988443635',
  patientDeletedAt: null,
  bookingName: null,
  bookingPhone: null,
  status: 'scheduled',
  date: '2026-06-02',
  startTime: '14:30:00',
}

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
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-06-01T12:00:00-03:00'))
  vi.mocked(getAuthContext).mockResolvedValue(AUTH_CTX as never)
  vi.mocked(requireWrite).mockResolvedValue({ ctx: AUTH_CTX, blocked: null } as never)
  vi.mocked(getTenant).mockResolvedValue({
    id: 'tenant-1',
    name: 'Flora Clinic',
    settings: { whatsapp_mode: 'own', whatsapp_enabled: true },
  } as never)
  vi.mocked(claimFailedMessageForRetry).mockResolvedValue({
    id: 'msg-1',
    conversationId: 'conv-1',
    direction: 'outbound',
    deliveryStatus: 'retrying',
    metaMessageId: 'wamid.old',
    templateName: 'appointment_confirmation_v1',
  } as never)
  vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue(APPOINTMENT as never)
  vi.mocked(relinkConfirmationMessageId).mockResolvedValue({ id: 'appt-1' } as never)
  vi.mocked(getTemplateForTenant).mockResolvedValue({
    name: 'appointment_confirmation_v2',
    language: 'pt_BR',
    status: 'APPROVED',
    components: [],
  } as never)
  vi.mocked(sendTemplateMessage).mockResolvedValue({ metaMessageId: 'wamid.new' } as never)
  vi.mocked(upsertConversation).mockResolvedValue({ id: 'conv-current' } as never)
  vi.mocked(resolveTemplateBody).mockReturnValue('Olá Maria' as never)
  vi.mocked(createMessage).mockResolvedValue({ id: 'msg-new', conversationId: 'conv-current' } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('POST /api/whatsapp/conversations/[id]/messages/[messageId]/retry', () => {
  it('resends the confirmation via the purpose template, marks the old message retried and relinks the appointment', async () => {
    const res = await POST(request(), params())

    expect(res.status).toBe(201)
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      'tenant-1',
      {
        actor: { type: 'user', userId: 'user-1' },
        recipient: { patientId: 'patient-1', conversationId: 'conv-1', name: 'Maria Silva' },
      },
      '5547988443635',
      'appointment_confirmation_v2',
      'pt_BR',
      { '1': 'Maria', '2': 'Flora Clinic', '3': '02/06/2026', '4': '14:30' },
    )
    expect(releaseRetryClaim).toHaveBeenCalledWith('tenant-1', 'msg-1', 'retried')
    expect(releaseRetryClaim).not.toHaveBeenCalledWith('tenant-1', 'msg-1', 'failed')
    expect(relinkConfirmationMessageId).toHaveBeenCalledWith('tenant-1', 'appt-1', 'wamid.old', 'wamid.new')
    expect(upsertConversation).toHaveBeenCalledWith('tenant-1', '5547988443635', 'Maria Silva', undefined, 'patient-1')
    expect(createMessage).toHaveBeenCalledWith(
      'tenant-1',
      'conv-current',
      expect.objectContaining({ metaMessageId: 'wamid.new', deliveryStatus: 'sent' }),
    )
    expect(pushSseEvent).toHaveBeenCalledWith('tenant-1', 'new_message', {
      conversationId: 'conv-current',
      message: { id: 'msg-new', conversationId: 'conv-current' },
    })
  })

  // Regression: swapping `patientPhone ?? bookingPhone` would resend to the
  // number captured at booking time instead of the patient's current one.
  it('sends to the patient phone when both patient and booking phones are set', async () => {
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      ...APPOINTMENT,
      bookingPhone: '11987654321',
    } as never)

    await POST(request(), params())

    expect(vi.mocked(sendTemplateMessage).mock.calls[0][2]).toBe('5547988443635')
  })

  // Regression: comparing a bare `new Date(appointment.date)` (UTC midnight)
  // rejects an appointment later today in BR time as already past.
  it('resends for an appointment later today in BR time', async () => {
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      ...APPOINTMENT,
      date: '2026-06-01',
      startTime: '18:00:00',
    } as never)

    const res = await POST(request(), params())

    expect(res.status).toBe(201)
    expect(sendTemplateMessage).toHaveBeenCalled()
  })

  // Regression: an appointment rescheduled mid-retry (relink matches no row)
  // reported as a failure, so staff resend a message Meta already delivered.
  it('returns 201 with a warning and marks the old message retried when the relink finds no row', async () => {
    vi.mocked(relinkConfirmationMessageId).mockResolvedValue(null as never)

    const res = await POST(request(), params())
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toEqual({ id: 'msg-new', conversationId: 'conv-current' })
    expect(body.warning).toBe('Mensagem reenviada, mas o agendamento mudou durante o reenvio e não foi vinculado.')
    expect(releaseRetryClaim).toHaveBeenCalledWith('tenant-1', 'msg-1', 'retried')
  })

  // Regression: a DB error after Meta accepted the send reverting the claim
  // to failed, which offers the staff a duplicate resend.
  it('returns 201 with a warning and keeps the claim when bookkeeping fails after the send', async () => {
    const dbError = new Error('connection reset')
    vi.mocked(createMessage).mockRejectedValue(dbError)

    const res = await POST(request(), params())
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.warning).toBe('Mensagem reenviada, mas não foi possível atualizar o histórico.')
    expect(Sentry.captureException).toHaveBeenCalledWith(dbError, expect.anything())
    expect(releaseRetryClaim).toHaveBeenCalledWith('tenant-1', 'msg-1', 'retried')
    expect(releaseRetryClaim).not.toHaveBeenCalledWith('tenant-1', 'msg-1', 'failed')
  })

  // Regression: a second click while the first retry holds the claim resending again.
  it('returns 409 without sending when the message cannot be claimed', async () => {
    vi.mocked(claimFailedMessageForRetry).mockResolvedValue(null)

    const res = await POST(request(), params())

    expect(res.status).toBe(409)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
    expect(releaseRetryClaim).not.toHaveBeenCalled()
  })

  it('returns 400 and releases the claim when the current phone is invalid', async () => {
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      ...APPOINTMENT,
      patientPhone: '123',
    } as never)

    const res = await POST(request(), params())

    expect(res.status).toBe(400)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
    expect(releaseRetryClaim).toHaveBeenCalledWith('tenant-1', 'msg-1', 'failed')
  })

  it.each([
    ['cancelled', { status: 'cancelled' }],
    ['already started', { startTime: '11:00:00', date: '2026-06-01' }],
    ['past', { date: '2026-05-30' }],
    ['for a deleted patient', { patientDeletedAt: new Date('2026-05-01T00:00:00Z') }],
  ])('returns 400 without sending when the appointment is %s', async (_label, override) => {
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      ...APPOINTMENT,
      ...override,
    } as never)

    const res = await POST(request(), params())

    expect(res.status).toBe(400)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
    expect(releaseRetryClaim).toHaveBeenCalledWith('tenant-1', 'msg-1', 'failed')
  })

  // Regression: a failed send leaving the message stuck in 'retrying', which
  // hides the retry button forever.
  it.each([
    ['Meta rejects the send', new Error('Meta API error: (#131026) Message undeliverable'), 502],
    ['credits are exhausted', new CreditExhaustedError(100, 100, 1), 402],
  ])('reverts the claim to failed when %s', async (_label, error, status) => {
    vi.mocked(sendTemplateMessage).mockRejectedValue(error)

    const res = await POST(request(), params())

    expect(res.status).toBe(status)
    expect(releaseRetryClaim).toHaveBeenCalledWith('tenant-1', 'msg-1', 'failed')
    expect(releaseRetryClaim).not.toHaveBeenCalledWith('tenant-1', 'msg-1', 'retried')
    expect(relinkConfirmationMessageId).not.toHaveBeenCalled()
  })
})
