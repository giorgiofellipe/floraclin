/**
 * Unit tests for the WhatsApp automations cron job.
 *
 * The cron runs daily at 08:00 BRT, iterates WhatsApp-enabled tenants, and
 * sends appointment-confirmation templates for upcoming appointments.
 *
 * Because Vercel invokes this route and discards the response body, the
 * route records a structured outcome reason per tenant and reports real
 * failures (not ordinary skips) to Sentry. These tests exercise both: the
 * outcome taxonomy returned in the response, and what does/doesn't reach
 * Sentry.
 *
 * All DB queries and the WhatsApp send API are mocked -- no network or
 * database access occurs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks (hoisted by vitest) ────────────────────────────────────────

const captureExceptionMock = vi.fn()
const captureMessageMock = vi.fn()

vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}))

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
  },
}))

vi.mock('@/db/schema', () => ({
  tenants: { id: 'id', name: 'name', settings: 'settings' },
}))

vi.mock('@/db/queries/appointments', () => ({
  getAppointmentsPendingConfirmationUntil: vi.fn(),
  markConfirmationSent: vi.fn(),
}))

vi.mock('@/db/queries/whatsapp', () => ({
  listAutomations: vi.fn(),
  getTemplateByPurpose: vi.fn(),
  upsertConversation: vi.fn(),
  createMessage: vi.fn(),
  pushSseEvent: vi.fn(),
}))

vi.mock('@/lib/whatsapp', () => ({
  sendTemplateMessage: vi.fn(),
  resolveTemplateBody: vi.fn(),
  getTemplateForTenant: vi.fn(),
  CreditExhaustedError: class CreditExhaustedError extends Error {
    constructor(public creditsUsed: number, public creditsTotal: number) {
      super(`Credits exhausted: ${creditsUsed}/${creditsTotal}`)
      this.name = 'CreditExhaustedError'
    }
  },
}))

vi.mock('@/lib/plans', () => ({
  isSubscriptionActive: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/phone', () => ({
  normalizeBrPhone: vi.fn((phone: string) => {
    const digits = phone.replace(/\D/g, '')
    return digits.startsWith('55') ? digits : `55${digits}`
  }),
}))

// ─── Imports (after mocks) ───────────────────────────────────────────

import { db } from '@/db/client'

const dbMock = db as unknown as { select: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> }
import {
  getAppointmentsPendingConfirmationUntil,
  markConfirmationSent,
} from '@/db/queries/appointments'
import {
  listAutomations,
  upsertConversation,
  createMessage,
  pushSseEvent,
} from '@/db/queries/whatsapp'
import { sendTemplateMessage, resolveTemplateBody, getTemplateForTenant, CreditExhaustedError } from '@/lib/whatsapp'
import { isSubscriptionActive } from '@/lib/plans'
import { GET } from '../route'

// ─── Helpers ─────────────────────────────────────────────────────────

const CRON_SECRET = 'test-cron-secret'

function makeRequest(token?: string): Request {
  const headers: Record<string, string> = {}
  if (token) headers['authorization'] = `Bearer ${token}`
  return new Request('http://localhost/api/cron/whatsapp-automations', {
    method: 'GET',
    headers,
  })
}

function makeTenant(
  id: string,
  name: string,
  settings: Record<string, unknown> | null = null,
) {
  return { id, name, settings }
}

function makeAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appt-1',
    tenantId: 'tenant-1',
    patientId: 'patient-1',
    practitionerId: 'pract-1',
    date: '2026-06-02',
    startTime: '14:30:00',
    bookingName: null,
    bookingPhone: null,
    patientName: 'Maria Silva',
    patientPhone: '(11) 99999-1234',
    ...overrides,
  }
}

function makeTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tpl-1',
    tenantId: 'tenant-1',
    name: 'appointment_confirmation_v1',
    language: 'pt_BR',
    status: 'APPROVED',
    category: 'UTILITY',
    metaTemplateId: 'meta-tpl-1',
    components: [{ type: 'BODY', text: 'Olá {{1}}, sua consulta em {{2}} está agendada para {{3}} às {{4}}.' }],
    purposeKey: 'appointment_confirmation',
    rejectedReason: null,
    variables: [],
    description: '',
    createdAt: new Date(),
    syncedAt: new Date(),
    ...overrides,
  } as never
}

function makeAutomation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'auto-1',
    tenantId: 'tenant-1',
    trigger: 'appointment_confirmation',
    enabled: true,
    templateId: 'tpl-1',
    config: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as never
}

/** Wires the mocks for a tenant that sails through every gate. */
function setupHappyPath(appointments = [makeAppointment()]) {
  const template = makeTemplate()
  dbMock.from.mockResolvedValue([
    makeTenant('tenant-1', 'Flora Clinic', { whatsapp_enabled: true }),
  ])
  vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
  vi.mocked(getTemplateForTenant).mockResolvedValue(template)
  vi.mocked(getAppointmentsPendingConfirmationUntil).mockResolvedValue(appointments)
  vi.mocked(sendTemplateMessage).mockResolvedValue({ metaMessageId: 'wamid.abc123' })
  vi.mocked(markConfirmationSent).mockResolvedValue(undefined as never)
  vi.mocked(upsertConversation).mockResolvedValue({ id: 'conv-1' } as never)
  vi.mocked(resolveTemplateBody).mockReturnValue('Olá Maria, sua consulta...')
  vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1' } as never)
  vi.mocked(pushSseEvent).mockResolvedValue(undefined as never)
  return template
}

interface TenantOutcomeJson {
  tenantId: string
  tenantName: string
  reason: string
  appointmentsSent: number
  appointmentsFailed: number
}

function findOutcome(json: { outcomes: TenantOutcomeJson[] }, tenantId: string) {
  return json.outcomes.find((o) => o.tenantId === tenantId)
}

// ─── Setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
  vi.mocked(isSubscriptionActive).mockResolvedValue(true)

  // Default: db.select().from() returns empty tenants list
  dbMock.from.mockResolvedValue([])
})

// ─── Tests ───────────────────────────────────────────────────────────

describe('GET /api/cron/whatsapp-automations', () => {
  // ── Auth ──────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('returns 401 when no authorization header is present', async () => {
      const res = await GET(makeRequest())
      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toBe('Unauthorized')
    })

    it('returns 401 when bearer token does not match CRON_SECRET', async () => {
      const res = await GET(makeRequest('wrong-secret'))
      expect(res.status).toBe(401)
    })

    it('returns 401 when CRON_SECRET env var is not set', async () => {
      delete process.env.CRON_SECRET
      const res = await GET(makeRequest(CRON_SECRET))
      expect(res.status).toBe(401)
    })
  })

  // ── Outcome taxonomy: one reason per gate ────────────────────────

  describe('outcome taxonomy', () => {
    it('records wa_disabled for a tenant on own mode with whatsapp disabled', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t1', 'Clinic A', { whatsapp_mode: 'own', whatsapp_enabled: false }),
      ])

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.sent).toBe(0)
      expect(findOutcome(json, 't1')?.reason).toBe('wa_disabled')
      expect(json.summary.wa_disabled).toBe(1)
      expect(listAutomations).not.toHaveBeenCalled()
      expect(captureExceptionMock).not.toHaveBeenCalled()
      expect(captureMessageMock).not.toHaveBeenCalled()
    })

    it('does not filter tenants on own mode with whatsapp enabled, or on default floraclin mode', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t2', 'Clinic B', { whatsapp_mode: 'own', whatsapp_enabled: true }),
        makeTenant('t3', 'Clinic C', null),
      ])
      vi.mocked(listAutomations).mockResolvedValue([])

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(findOutcome(json, 't2')?.reason).toBe('no_automation')
      expect(findOutcome(json, 't3')?.reason).toBe('no_automation')
    })

    it('records subscription_inactive and does not call Sentry', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t1', 'Clinic A', { whatsapp_enabled: true }),
      ])
      vi.mocked(isSubscriptionActive).mockResolvedValue(false)

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(findOutcome(json, 't1')?.reason).toBe('subscription_inactive')
      expect(listAutomations).not.toHaveBeenCalled()
      expect(captureExceptionMock).not.toHaveBeenCalled()
    })

    it('records no_automation when there is no enabled appointment_confirmation automation', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t1', 'Clinic A', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([
        makeAutomation({ trigger: 'birthday_greeting' }),
        makeAutomation({ trigger: 'appointment_confirmation', enabled: false }),
      ])

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(findOutcome(json, 't1')?.reason).toBe('no_automation')
      expect(getTemplateForTenant).not.toHaveBeenCalled()
      expect(captureExceptionMock).not.toHaveBeenCalled()
    })

    it('records template_missing when getTemplateForTenant returns null', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t1', 'Clinic A', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(getTemplateForTenant).mockResolvedValue(null)

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(findOutcome(json, 't1')?.reason).toBe('template_missing')
      expect(captureExceptionMock).not.toHaveBeenCalled()
    })

    it('records template_not_approved when the template is PENDING', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t1', 'Clinic A', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(getTemplateForTenant).mockResolvedValue(makeTemplate({ status: 'PENDING' }))

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(findOutcome(json, 't1')?.reason).toBe('template_not_approved')
      expect(sendTemplateMessage).not.toHaveBeenCalled()
      expect(captureExceptionMock).not.toHaveBeenCalled()
    })

    it('records no_pending_appointments when the query returns no appointments', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t1', 'Clinic A', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(getTemplateForTenant).mockResolvedValue(makeTemplate())
      vi.mocked(getAppointmentsPendingConfirmationUntil).mockResolvedValue([])

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(findOutcome(json, 't1')?.reason).toBe('no_pending_appointments')
      expect(sendTemplateMessage).not.toHaveBeenCalled()
    })

    it('records no_valid_phone when appointments exist but none has a usable phone', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t1', 'Clinic A', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(getTemplateForTenant).mockResolvedValue(makeTemplate())
      vi.mocked(getAppointmentsPendingConfirmationUntil).mockResolvedValue([
        makeAppointment({ patientPhone: null, bookingPhone: null }),
      ])

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(findOutcome(json, 't1')?.reason).toBe('no_valid_phone')
      expect(sendTemplateMessage).not.toHaveBeenCalled()
      expect(captureExceptionMock).not.toHaveBeenCalled()
    })

    it('records sent when at least one confirmation goes out', async () => {
      setupHappyPath()

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      const outcome = findOutcome(json, 'tenant-1')
      expect(outcome?.reason).toBe('sent')
      expect(outcome?.appointmentsSent).toBe(1)
      expect(outcome?.appointmentsFailed).toBe(0)
      expect(json.summary.sent).toBe(1)
    })

    it('records tenant_error (and reports to Sentry) when a gate query throws unexpectedly', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t-fail', 'Failing Clinic', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockRejectedValue(new Error('DB connection lost'))

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(findOutcome(json, 't-fail')?.reason).toBe('tenant_error')
      expect(captureExceptionMock).toHaveBeenCalledTimes(1)
      expect(captureExceptionMock).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ extra: expect.objectContaining({ tenantId: 't-fail', tenantName: 'Failing Clinic' }) }),
      )
    })
  })

  // ── Sending confirmations ────────────────────────────────────────

  describe('sending confirmations', () => {
    it('calls sendTemplateMessage with correct params', async () => {
      setupHappyPath()

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.sent).toBe(1)
      expect(sendTemplateMessage).toHaveBeenCalledWith(
        'tenant-1',
        '5511999991234',
        'appointment_confirmation_v1',
        'pt_BR',
        {
          '1': 'Maria',         // first name
          '2': 'Flora Clinic',  // tenant name
          '3': '02/06/2026',    // BR date format DD/MM/YYYY
          '4': '14:30',         // time HH:MM
        },
      )
    })

    it('marks the appointment as confirmation-sent after sending', async () => {
      setupHappyPath()

      await GET(makeRequest(CRON_SECRET))

      expect(markConfirmationSent).toHaveBeenCalledWith(
        'tenant-1',
        'appt-1',
        'wamid.abc123',
      )
    })

    it('creates a conversation and message record after sending', async () => {
      setupHappyPath()

      await GET(makeRequest(CRON_SECRET))

      expect(upsertConversation).toHaveBeenCalledWith(
        'tenant-1',
        '5511999991234',
        'Maria Silva',
        undefined,
        'patient-1',
      )
      expect(createMessage).toHaveBeenCalledWith(
        'tenant-1',
        'conv-1',
        expect.objectContaining({
          direction: 'outbound',
          metaMessageId: 'wamid.abc123',
          templateName: 'appointment_confirmation_v1',
          deliveryStatus: 'sent',
        }),
      )
    })

    it('pushes SSE event after creating message', async () => {
      setupHappyPath()

      await GET(makeRequest(CRON_SECRET))

      expect(pushSseEvent).toHaveBeenCalledWith(
        'tenant-1',
        'new_message',
        expect.objectContaining({
          conversationId: 'conv-1',
          message: { id: 'msg-1' },
        }),
      )
    })

    it('sends to multiple appointments in the same tenant', async () => {
      const appts = [
        makeAppointment({ id: 'appt-1', patientPhone: '11988881111' }),
        makeAppointment({ id: 'appt-2', patientPhone: '11988882222', patientName: 'João Costa' }),
      ]
      setupHappyPath(appts)

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.sent).toBe(2)
      expect(sendTemplateMessage).toHaveBeenCalledTimes(2)
      expect(findOutcome(json, 'tenant-1')?.appointmentsSent).toBe(2)
    })

    it('uses bookingPhone when patientPhone is null', async () => {
      setupHappyPath([
        makeAppointment({
          patientPhone: null,
          bookingPhone: '(21) 98888-5678',
          patientName: null,
          bookingName: 'Ana Costa',
        }),
      ])

      await GET(makeRequest(CRON_SECRET))

      expect(sendTemplateMessage).toHaveBeenCalledWith(
        'tenant-1',
        '5521988885678',
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ '1': 'Ana' }),
      )
    })

    it('skips appointment when neither patientPhone nor bookingPhone is present, alongside others that send', async () => {
      setupHappyPath([
        makeAppointment({ id: 'appt-nophone', patientPhone: null, bookingPhone: null }),
        makeAppointment({ id: 'appt-ok', patientPhone: '11999990000' }),
      ])

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.sent).toBe(1)
      expect(sendTemplateMessage).toHaveBeenCalledTimes(1)
      expect(findOutcome(json, 'tenant-1')?.reason).toBe('sent')
    })

    it('uses the full name as firstName when name has no spaces', async () => {
      setupHappyPath([
        makeAppointment({ patientName: 'Beyoncé' }),
      ])

      await GET(makeRequest(CRON_SECRET))

      expect(sendTemplateMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ '1': 'Beyoncé' }),
      )
    })

    it('uses empty string as firstName when both names are null', async () => {
      setupHappyPath([
        makeAppointment({
          patientName: null,
          bookingName: null,
          bookingPhone: '11999990000',
        }),
      ])

      await GET(makeRequest(CRON_SECRET))

      expect(sendTemplateMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ '1': '' }),
      )
    })

    it('passes only tenantId to the query', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('tenant-1', 'Flora Clinic', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(getTemplateForTenant).mockResolvedValue(makeTemplate())
      vi.mocked(getAppointmentsPendingConfirmationUntil).mockResolvedValue([])

      await GET(makeRequest(CRON_SECRET))

      expect(getAppointmentsPendingConfirmationUntil).toHaveBeenCalledWith(
        'tenant-1',
      )
    })
  })

  // ── Phone normalization ──────────────────────────────────────────

  describe('phone normalization', () => {
    function setupWithPhone(phone: string) {
      dbMock.from.mockResolvedValue([
        makeTenant('tenant-1', 'Flora Clinic', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(getTemplateForTenant).mockResolvedValue(makeTemplate())
      vi.mocked(getAppointmentsPendingConfirmationUntil).mockResolvedValue([
        makeAppointment({ patientPhone: phone }),
      ])
      vi.mocked(sendTemplateMessage).mockResolvedValue({ metaMessageId: 'wamid.x' })
      vi.mocked(markConfirmationSent).mockResolvedValue(undefined as never)
      vi.mocked(upsertConversation).mockResolvedValue({ id: 'conv-1' } as never)
      vi.mocked(resolveTemplateBody).mockReturnValue('text')
      vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1' } as never)
      vi.mocked(pushSseEvent).mockResolvedValue(undefined as never)
    }

    it('strips non-digit characters and adds 55 prefix', async () => {
      setupWithPhone('(11) 99999-1234')

      await GET(makeRequest(CRON_SECRET))

      expect(sendTemplateMessage).toHaveBeenCalledWith(
        expect.any(String),
        '5511999991234',
        expect.any(String),
        expect.any(String),
        expect.any(Object),
      )
    })

    it('does not double-add 55 prefix when already present', async () => {
      setupWithPhone('5511999991234')

      await GET(makeRequest(CRON_SECRET))

      expect(sendTemplateMessage).toHaveBeenCalledWith(
        expect.any(String),
        '5511999991234',
        expect.any(String),
        expect.any(String),
        expect.any(Object),
      )
    })

    it('adds 55 prefix to digits-only number without country code', async () => {
      setupWithPhone('11999991234')

      await GET(makeRequest(CRON_SECRET))

      expect(sendTemplateMessage).toHaveBeenCalledWith(
        expect.any(String),
        '5511999991234',
        expect.any(String),
        expect.any(String),
        expect.any(Object),
      )
    })

    it('handles phone with +55 prefix', async () => {
      setupWithPhone('+5511999991234')

      await GET(makeRequest(CRON_SECRET))

      expect(sendTemplateMessage).toHaveBeenCalledWith(
        expect.any(String),
        '5511999991234',
        expect.any(String),
        expect.any(String),
        expect.any(Object),
      )
    })
  })

  // ── Date formatting ──────────────────────────────────────────────

  describe('date formatting', () => {
    function setupWithDate(date: string, startTime: string) {
      dbMock.from.mockResolvedValue([
        makeTenant('tenant-1', 'Clinic', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(getTemplateForTenant).mockResolvedValue(makeTemplate())
      vi.mocked(getAppointmentsPendingConfirmationUntil).mockResolvedValue([
        makeAppointment({ date, startTime }),
      ])
      vi.mocked(sendTemplateMessage).mockResolvedValue({ metaMessageId: 'wamid.x' })
      vi.mocked(markConfirmationSent).mockResolvedValue(undefined as never)
      vi.mocked(upsertConversation).mockResolvedValue({ id: 'conv-1' } as never)
      vi.mocked(resolveTemplateBody).mockReturnValue('text')
      vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1' } as never)
      vi.mocked(pushSseEvent).mockResolvedValue(undefined as never)
    }

    it('formats YYYY-MM-DD to DD/MM/YYYY', async () => {
      setupWithDate('2026-06-02', '09:00:00')

      await GET(makeRequest(CRON_SECRET))

      expect(sendTemplateMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ '3': '02/06/2026' }),
      )
    })

    it('formats time as HH:MM (strips seconds)', async () => {
      setupWithDate('2026-12-25', '15:45:00')

      await GET(makeRequest(CRON_SECRET))

      expect(sendTemplateMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ '3': '25/12/2026', '4': '15:45' }),
      )
    })
  })

  // ── Error handling & Sentry ──────────────────────────────────────

  describe('error handling', () => {
    it('per-appointment error does not stop processing other appointments, and reports to Sentry', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('tenant-1', 'Flora Clinic', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(getTemplateForTenant).mockResolvedValue(makeTemplate())
      vi.mocked(getAppointmentsPendingConfirmationUntil).mockResolvedValue([
        makeAppointment({ id: 'appt-fail', patientPhone: '11999990001' }),
        makeAppointment({ id: 'appt-ok', patientPhone: '11999990002' }),
      ])
      const metaError = new Error('Meta API timeout')
      vi.mocked(sendTemplateMessage)
        .mockRejectedValueOnce(metaError)
        .mockResolvedValueOnce({ metaMessageId: 'wamid.ok' })
      vi.mocked(markConfirmationSent).mockResolvedValue(undefined as never)
      vi.mocked(upsertConversation).mockResolvedValue({ id: 'conv-1' } as never)
      vi.mocked(resolveTemplateBody).mockReturnValue('text')
      vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1' } as never)
      vi.mocked(pushSseEvent).mockResolvedValue(undefined as never)

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.sent).toBe(1)
      const outcome = findOutcome(json, 'tenant-1')
      expect(outcome?.reason).toBe('sent')
      expect(outcome?.appointmentsSent).toBe(1)
      expect(outcome?.appointmentsFailed).toBe(1)

      expect(captureExceptionMock).toHaveBeenCalledTimes(1)
      expect(captureExceptionMock).toHaveBeenCalledWith(
        metaError,
        expect.objectContaining({
          extra: expect.objectContaining({
            tenantId: 'tenant-1',
            tenantName: 'Flora Clinic',
            appointmentId: 'appt-fail',
          }),
        }),
      )
    })

    it('records send_failed when every appointment for a tenant fails, without aborting other tenants', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t-fail', 'Failing Clinic', { whatsapp_enabled: true }),
        makeTenant('t-ok', 'OK Clinic', { whatsapp_enabled: true }),
      ])

      vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(getTemplateForTenant).mockResolvedValue(makeTemplate())
      vi.mocked(getAppointmentsPendingConfirmationUntil)
        .mockResolvedValueOnce([makeAppointment({ id: 'a-fail', patientPhone: '11999990003' })])
        .mockResolvedValueOnce([makeAppointment({ id: 'a-ok', patientPhone: '11999990004' })])
      vi.mocked(sendTemplateMessage)
        .mockRejectedValueOnce(new Error('Meta API down'))
        .mockResolvedValueOnce({ metaMessageId: 'wamid.y' })
      vi.mocked(markConfirmationSent).mockResolvedValue(undefined as never)
      vi.mocked(upsertConversation).mockResolvedValue({ id: 'conv-1' } as never)
      vi.mocked(resolveTemplateBody).mockReturnValue('text')
      vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1' } as never)
      vi.mocked(pushSseEvent).mockResolvedValue(undefined as never)

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.sent).toBe(1)
      expect(findOutcome(json, 't-fail')?.reason).toBe('send_failed')
      expect(findOutcome(json, 't-ok')?.reason).toBe('sent')
      expect(captureExceptionMock).toHaveBeenCalledTimes(1)
    })

    it('returns 200 with a summary even when all tenants fail', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t1', 'Clinic A', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockRejectedValue(new Error('total failure'))

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.ok).toBe(true)
      expect(json.sent).toBe(0)
      expect(json.summary.tenant_error).toBe(1)
    })

    it('does not call Sentry for ordinary skips (no eligible appointments)', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t1', 'Clinic A', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(getTemplateForTenant).mockResolvedValue(makeTemplate())
      vi.mocked(getAppointmentsPendingConfirmationUntil).mockResolvedValue([])

      await GET(makeRequest(CRON_SECRET))

      expect(captureExceptionMock).not.toHaveBeenCalled()
      expect(captureMessageMock).not.toHaveBeenCalled()
    })
  })

  // ── Credit exhaustion ────────────────────────────────────────────

  describe('credit exhaustion', () => {
    it('records credit_exhausted as its own outcome, distinct from send_failed', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('tenant-1', 'Flora Clinic', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(getTemplateForTenant).mockResolvedValue(makeTemplate())
      vi.mocked(getAppointmentsPendingConfirmationUntil).mockResolvedValue([
        makeAppointment({ id: 'appt-1', patientPhone: '11999990001' }),
        makeAppointment({ id: 'appt-2', patientPhone: '11999990002' }),
      ])
      vi.mocked(sendTemplateMessage).mockRejectedValue(new CreditExhaustedError(100, 100))

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      const outcome = findOutcome(json, 'tenant-1')
      expect(outcome?.reason).toBe('credit_exhausted')
      expect(outcome?.reason).not.toBe('send_failed')
      expect(json.summary.credit_exhausted).toBe(1)
    })

    it('stops processing remaining appointments for that tenant once credits are exhausted', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('tenant-1', 'Flora Clinic', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(getTemplateForTenant).mockResolvedValue(makeTemplate())
      vi.mocked(getAppointmentsPendingConfirmationUntil).mockResolvedValue([
        makeAppointment({ id: 'appt-1', patientPhone: '11999990001' }),
        makeAppointment({ id: 'appt-2', patientPhone: '11999990002' }),
      ])
      vi.mocked(sendTemplateMessage).mockRejectedValue(new CreditExhaustedError(50, 50))

      await GET(makeRequest(CRON_SECRET))

      expect(sendTemplateMessage).toHaveBeenCalledTimes(1)
    })

    it('reports credit exhaustion to Sentry as a message, not an exception', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('tenant-1', 'Flora Clinic', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(getTemplateForTenant).mockResolvedValue(makeTemplate())
      vi.mocked(getAppointmentsPendingConfirmationUntil).mockResolvedValue([
        makeAppointment({ id: 'appt-1', patientPhone: '11999990001' }),
      ])
      vi.mocked(sendTemplateMessage).mockRejectedValue(new CreditExhaustedError(20, 20))

      await GET(makeRequest(CRON_SECRET))

      expect(captureMessageMock).toHaveBeenCalledTimes(1)
      expect(captureMessageMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          level: 'warning',
          extra: expect.objectContaining({ tenantId: 'tenant-1', tenantName: 'Flora Clinic' }),
        }),
      )
      expect(captureExceptionMock).not.toHaveBeenCalled()
    })

    it('does not stop processing other tenants after one hits credit exhaustion', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t-exhausted', 'Exhausted Clinic', { whatsapp_enabled: true }),
        makeTenant('t-ok', 'OK Clinic', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(getTemplateForTenant).mockResolvedValue(makeTemplate())
      vi.mocked(getAppointmentsPendingConfirmationUntil)
        .mockResolvedValueOnce([makeAppointment({ id: 'a1', patientPhone: '11999990005' })])
        .mockResolvedValueOnce([makeAppointment({ id: 'a2', patientPhone: '11999990006' })])
      vi.mocked(sendTemplateMessage)
        .mockRejectedValueOnce(new CreditExhaustedError(10, 10))
        .mockResolvedValueOnce({ metaMessageId: 'wamid.z' })
      vi.mocked(markConfirmationSent).mockResolvedValue(undefined as never)
      vi.mocked(upsertConversation).mockResolvedValue({ id: 'conv-1' } as never)
      vi.mocked(resolveTemplateBody).mockReturnValue('text')
      vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1' } as never)
      vi.mocked(pushSseEvent).mockResolvedValue(undefined as never)

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(findOutcome(json, 't-exhausted')?.reason).toBe('credit_exhausted')
      expect(findOutcome(json, 't-ok')?.reason).toBe('sent')
      expect(json.sent).toBe(1)
    })
  })

  // ── Idempotency (confirmationSentAt) ─────────────────────────────

  describe('idempotency', () => {
    it('does not re-send when query returns no pending appointments', async () => {
      // The SQL query filters on `confirmationSentAt IS NULL`, so
      // already-sent appointments never appear in the result set.
      // This test verifies the flow: if the query returns empty, nothing is sent.
      dbMock.from.mockResolvedValue([
        makeTenant('tenant-1', 'Flora Clinic', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(getTemplateForTenant).mockResolvedValue(makeTemplate())
      vi.mocked(getAppointmentsPendingConfirmationUntil).mockResolvedValue([])

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.sent).toBe(0)
      expect(sendTemplateMessage).not.toHaveBeenCalled()
      expect(markConfirmationSent).not.toHaveBeenCalled()
    })
  })

  // ── Multi-tenant ─────────────────────────────────────────────────

  describe('multi-tenant', () => {
    it('processes multiple WA-enabled tenants independently', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t1', 'Clinic One', { whatsapp_enabled: true }),
        makeTenant('t2', 'Clinic Two', { whatsapp_enabled: true }),
      ])

      vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(getTemplateForTenant).mockResolvedValue(makeTemplate())
      vi.mocked(getAppointmentsPendingConfirmationUntil)
        .mockResolvedValueOnce([makeAppointment({ id: 'a1', patientPhone: '11999990001' })])
        .mockResolvedValueOnce([makeAppointment({ id: 'a2', patientPhone: '11999990002' })])
      vi.mocked(sendTemplateMessage).mockResolvedValue({ metaMessageId: 'wamid.multi' })
      vi.mocked(markConfirmationSent).mockResolvedValue(undefined as never)
      vi.mocked(upsertConversation).mockResolvedValue({ id: 'conv-1' } as never)
      vi.mocked(resolveTemplateBody).mockReturnValue('text')
      vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1' } as never)
      vi.mocked(pushSseEvent).mockResolvedValue(undefined as never)

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.sent).toBe(2)
      expect(getAppointmentsPendingConfirmationUntil).toHaveBeenCalledTimes(2)
      expect(getAppointmentsPendingConfirmationUntil).toHaveBeenCalledWith('t1')
      expect(getAppointmentsPendingConfirmationUntil).toHaveBeenCalledWith('t2')
    })
  })

  // ── Run summary ──────────────────────────────────────────────────

  describe('run summary', () => {
    it('reports correct totals per outcome across a mixed run', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t-disabled', 'Disabled Clinic', { whatsapp_mode: 'own', whatsapp_enabled: false }),
        makeTenant('t-inactive', 'Inactive Clinic', { whatsapp_enabled: true }),
        makeTenant('t-no-auto', 'No Automation Clinic', { whatsapp_enabled: true }),
        makeTenant('t-sent', 'Sending Clinic', { whatsapp_enabled: true }),
      ])

      vi.mocked(isSubscriptionActive).mockImplementation(async (tenantId: string) =>
        tenantId !== 't-inactive',
      )
      vi.mocked(listAutomations).mockImplementation(async (tenantId: string) => {
        if (tenantId === 't-no-auto') return []
        return [makeAutomation()]
      })
      vi.mocked(getTemplateForTenant).mockResolvedValue(makeTemplate())
      vi.mocked(getAppointmentsPendingConfirmationUntil).mockResolvedValue([
        makeAppointment({ id: 'a-sent', patientPhone: '11999990009' }),
      ])
      vi.mocked(sendTemplateMessage).mockResolvedValue({ metaMessageId: 'wamid.summary' })
      vi.mocked(markConfirmationSent).mockResolvedValue(undefined as never)
      vi.mocked(upsertConversation).mockResolvedValue({ id: 'conv-1' } as never)
      vi.mocked(resolveTemplateBody).mockReturnValue('text')
      vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1' } as never)
      vi.mocked(pushSseEvent).mockResolvedValue(undefined as never)

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.summary).toEqual({
        wa_disabled: 1,
        subscription_inactive: 1,
        no_automation: 1,
        sent: 1,
      })
      expect(json.sent).toBe(1)
      expect(json.outcomes).toHaveLength(4)
    })
  })
})
