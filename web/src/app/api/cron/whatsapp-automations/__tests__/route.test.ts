/**
 * Unit tests for the WhatsApp automations cron job.
 *
 * The cron runs hourly, iterates WhatsApp-enabled tenants, and sends
 * appointment-confirmation templates for upcoming appointments.
 *
 * All DB queries and the WhatsApp send API are mocked — no network or
 * database access occurs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks (hoisted by vitest) ────────────────────────────────────────

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
  getTemplateByPurpose,
  upsertConversation,
  createMessage,
  pushSseEvent,
} from '@/db/queries/whatsapp'
import { sendTemplateMessage, resolveTemplateBody } from '@/lib/whatsapp'
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

// ─── Setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET

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

  // ── Tenant filtering ─────────────────────────────────────────────

  describe('tenant filtering', () => {
    it('skips tenants without whatsapp_enabled setting', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t1', 'Clinic A', { whatsapp_enabled: false }),
        makeTenant('t2', 'Clinic B', null),
        makeTenant('t3', 'Clinic C', { someOtherSetting: true }),
      ])

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.ok).toBe(true)
      expect(json.sent).toBe(0)
      // listAutomations should never be called for non-WA tenants
      expect(listAutomations).not.toHaveBeenCalled()
    })

    it('skips tenant without appointment_confirmation automation', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t1', 'Clinic A', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([
        makeAutomation({ trigger: 'birthday_greeting' }),
      ])

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.skipped).toBe(1)
      expect(json.sent).toBe(0)
      expect(getTemplateByPurpose).not.toHaveBeenCalled()
    })

    it('skips tenant when appointment_confirmation automation is disabled', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t1', 'Clinic A', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([
        makeAutomation({ enabled: false }),
      ])

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.skipped).toBe(1)
      expect(json.sent).toBe(0)
    })

    it('skips tenant when template is not APPROVED', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t1', 'Clinic A', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(getTemplateByPurpose).mockResolvedValue(
        makeTemplate({ status: 'PENDING' }),
      )

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.skipped).toBe(1)
      expect(json.sent).toBe(0)
      expect(sendTemplateMessage).not.toHaveBeenCalled()
    })

    it('skips tenant when template is null (not found)', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t1', 'Clinic A', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(getTemplateByPurpose).mockResolvedValue(null)

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.skipped).toBe(1)
      expect(json.sent).toBe(0)
    })

    it('skips tenant when automation has no templateId', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t1', 'Clinic A', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([
        makeAutomation({ templateId: null }),
      ])

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.skipped).toBe(1)
      expect(json.sent).toBe(0)
    })
  })

  // ── Sending confirmations ────────────────────────────────────────

  describe('sending confirmations', () => {
    function setupHappyPath(appointments = [makeAppointment()]) {
      const template = makeTemplate()
      dbMock.from.mockResolvedValue([
        makeTenant('tenant-1', 'Flora Clinic', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(getTemplateByPurpose).mockResolvedValue(template)
      vi.mocked(getAppointmentsPendingConfirmationUntil).mockResolvedValue(appointments)
      vi.mocked(sendTemplateMessage).mockResolvedValue({ metaMessageId: 'wamid.abc123' })
      vi.mocked(markConfirmationSent).mockResolvedValue(undefined as never)
      vi.mocked(upsertConversation).mockResolvedValue({ id: 'conv-1' } as never)
      vi.mocked(resolveTemplateBody).mockReturnValue('Olá Maria, sua consulta...')
      vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1' } as never)
      vi.mocked(pushSseEvent).mockResolvedValue(undefined as never)
      return template
    }

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

    it('skips appointment when neither patientPhone nor bookingPhone is present', async () => {
      setupHappyPath([
        makeAppointment({ patientPhone: null, bookingPhone: null }),
      ])

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.sent).toBe(0)
      expect(sendTemplateMessage).not.toHaveBeenCalled()
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
      vi.mocked(getTemplateByPurpose).mockResolvedValue(makeTemplate())
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
      vi.mocked(getTemplateByPurpose).mockResolvedValue(makeTemplate())
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
      vi.mocked(getTemplateByPurpose).mockResolvedValue(makeTemplate())
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

  // ── Error handling ───────────────────────────────────────────────

  describe('error handling', () => {
    it('per-appointment error does not stop processing other appointments', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('tenant-1', 'Flora Clinic', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(getTemplateByPurpose).mockResolvedValue(makeTemplate())
      vi.mocked(getAppointmentsPendingConfirmationUntil).mockResolvedValue([
        makeAppointment({ id: 'appt-fail', patientPhone: '11999990001' }),
        makeAppointment({ id: 'appt-ok', patientPhone: '11999990002' }),
      ])
      vi.mocked(sendTemplateMessage)
        .mockRejectedValueOnce(new Error('Meta API timeout'))
        .mockResolvedValueOnce({ metaMessageId: 'wamid.ok' })
      vi.mocked(markConfirmationSent).mockResolvedValue(undefined as never)
      vi.mocked(upsertConversation).mockResolvedValue({ id: 'conv-1' } as never)
      vi.mocked(resolveTemplateBody).mockReturnValue('text')
      vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1' } as never)
      vi.mocked(pushSseEvent).mockResolvedValue(undefined as never)

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.sent).toBe(1)
      expect(json.errors).toHaveLength(1)
      expect(json.errors[0].error).toContain('appt-fail')
      expect(json.errors[0].error).toContain('Meta API timeout')
    })

    it('per-tenant error does not stop processing other tenants', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t-fail', 'Failing Clinic', { whatsapp_enabled: true }),
        makeTenant('t-ok', 'OK Clinic', { whatsapp_enabled: true }),
      ])

      vi.mocked(listAutomations)
        .mockRejectedValueOnce(new Error('DB connection lost'))
        .mockResolvedValueOnce([makeAutomation()])

      vi.mocked(getTemplateByPurpose).mockResolvedValue(makeTemplate())
      vi.mocked(getAppointmentsPendingConfirmationUntil).mockResolvedValue([
        makeAppointment({ patientPhone: '11999990003' }),
      ])
      vi.mocked(sendTemplateMessage).mockResolvedValue({ metaMessageId: 'wamid.y' })
      vi.mocked(markConfirmationSent).mockResolvedValue(undefined as never)
      vi.mocked(upsertConversation).mockResolvedValue({ id: 'conv-1' } as never)
      vi.mocked(resolveTemplateBody).mockReturnValue('text')
      vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1' } as never)
      vi.mocked(pushSseEvent).mockResolvedValue(undefined as never)

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.sent).toBe(1)
      expect(json.errors).toHaveLength(1)
      expect(json.errors[0].tenant).toBe('Failing Clinic')
      expect(json.errors[0].error).toContain('DB connection lost')
    })

    it('returns 200 with summary even when all tenants fail', async () => {
      dbMock.from.mockResolvedValue([
        makeTenant('t1', 'Clinic A', { whatsapp_enabled: true }),
      ])
      vi.mocked(listAutomations).mockRejectedValue(new Error('total failure'))

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.ok).toBe(true)
      expect(json.sent).toBe(0)
      expect(json.errors).toHaveLength(1)
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
      vi.mocked(getTemplateByPurpose).mockResolvedValue(makeTemplate())
      vi.mocked(getAppointmentsPendingConfirmationUntil).mockResolvedValue([])

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.sent).toBe(0)
      expect(json.errors).toHaveLength(0)
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
      vi.mocked(getTemplateByPurpose).mockResolvedValue(makeTemplate())
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
})
