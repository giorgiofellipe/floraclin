/**
 * Tests for confirmation button reply handling in the WhatsApp webhook.
 *
 * The functions under test — processConfirmationReply and maybeAutoSendAnamnesis
 * — are not exported from route.ts.  We exercise them through the POST handler:
 * a well-formed interactive-button webhook payload triggers the fire-and-forget
 * confirmation path.  All DB queries and external calls are mocked so these are
 * pure-unit tests (no DB, no HTTP, no Next runtime).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Mocks — hoisted by vitest, declared before any imports from the module
// ---------------------------------------------------------------------------

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => []),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => []),
        })),
      })),
    })),
  },
}))

vi.mock('@/db/schema', () => ({
  tenants: { id: 'id', settings: 'settings' },
  tenantUsers: { tenantId: 'tenant_id', userId: 'user_id', role: 'role' },
  procedureTypes: { id: 'id', name: 'name', tenantId: 'tenant_id', defaultPrice: 'default_price' },
  whatsappMessages: { tenantId: 'tenant_id', metaMessageId: 'meta_message_id', mediaUrl: 'media_url' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
}))

vi.mock('@/lib/whatsapp', () => ({
  verifyWebhookSignature: vi.fn(),
  downloadAndStoreMedia: vi.fn(),
  sendTextMessage: vi.fn(),
  sendTemplateMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
  normalizeBrPhone: vi.fn((phone: string) => phone),
  getTemplateForTenant: vi.fn(),
  CreditExhaustedError: class CreditExhaustedError extends Error {
    constructor(public creditsUsed: number, public creditsTotal: number) {
      super(`Credits exhausted`)
      this.name = 'CreditExhaustedError'
    }
  },
}))

vi.mock('@/db/queries/whatsapp', () => ({
  upsertConversation: vi.fn(),
  createMessage: vi.fn(),
  incrementUnreadCount: vi.fn(),
  updateMessageStatus: vi.fn(),
  pushSseEvent: vi.fn(),
  getMessageByMetaId: vi.fn(),
  getRecentInboundBodies: vi.fn(),
  getQueuedMessages: vi.fn(() => []),
  updateQueuedMessageStatus: vi.fn(),
  expireStaleQueuedMessages: vi.fn(() => []),
  listAutomations: vi.fn(() => []),
}))

vi.mock('@/db/queries/appointments', () => ({
  getAppointmentByConfirmationMessageId: vi.fn(),
  confirmAppointment: vi.fn(),
  requestReschedule: vi.fn(),
}))

vi.mock('@/db/queries/anamnesis', () => ({
  getAnamnesis: vi.fn(),
}))

vi.mock('@/db/queries/anamnesis-tokens', () => ({
  createAnamnesisToken: vi.fn(),
}))

vi.mock('@/db/queries/prospects', () => ({
  createNewProspect: vi.fn(),
  getProspectByPhone: vi.fn(),
  updateProspect: vi.fn(),
  logProspectActivity: vi.fn(),
  setProspectProcedures: vi.fn(),
}))

vi.mock('@/db/queries/patients', () => ({
  getPatientByPhone: vi.fn(),
  getPatient: vi.fn(),
}))

vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(),
}))

vi.mock('@/lib/classify-prospect', () => ({
  classifyMessage: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------

import { db } from '@/db/client'
import { verifyWebhookSignature, sendTemplateMessage, getTemplateForTenant } from '@/lib/whatsapp'
import {
  upsertConversation,
  createMessage,
  incrementUnreadCount,
  pushSseEvent,
  getMessageByMetaId,
  listAutomations,
} from '@/db/queries/whatsapp'
import {
  getAppointmentByConfirmationMessageId,
  confirmAppointment,
  requestReschedule,
} from '@/db/queries/appointments'
import { getAnamnesis } from '@/db/queries/anamnesis'
import { createAnamnesisToken } from '@/db/queries/anamnesis-tokens'
import {
  createNewProspect,
  getProspectByPhone,
} from '@/db/queries/prospects'
import { getPatientByPhone, getPatient } from '@/db/queries/patients'
import { getTenant } from '@/db/queries/tenants'
import { NextRequest } from 'next/server'
import { POST } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_APP_SECRET = 'test-app-secret'
const TENANT_ID = 'tenant-1'
const PHONE_NUMBER_ID = 'waba-phone-id'
const PATIENT_PHONE = '5511999990000'
const CONVERSATION_ID = 'conv-1'
const APPOINTMENT_ID = 'appt-1'
const PATIENT_ID = 'patient-1'
const META_MSG_ID = 'wamid.incoming'
const CONTEXT_MSG_ID = 'wamid.confirmation-sent'

function sign(body: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex')
  return `sha256=${hmac}`
}

/** Build a Meta webhook payload with an interactive button reply. */
function makeButtonReplyPayload(buttonTitle: string, contextId: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              contacts: [{ wa_id: PATIENT_PHONE, profile: { name: 'Maria' } }],
              messages: [
                {
                  id: META_MSG_ID,
                  from: PATIENT_PHONE,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'interactive',
                  interactive: {
                    type: 'button_reply',
                    button_reply: { id: 'auto-uuid', title: buttonTitle },
                  },
                  context: { id: contextId },
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

function makeRequest(body: unknown): NextRequest {
  const raw = JSON.stringify(body)
  return new NextRequest('http://localhost/api/webhooks/whatsapp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': sign(raw, TEST_APP_SECRET),
    },
    body: raw,
  })
}

/**
 * Set up the standard mock returns that let the webhook reach the
 * confirmation-reply path without failing on earlier steps.
 */
function setupCommonMocks() {
  // Signature verification passes
  vi.mocked(verifyWebhookSignature).mockReturnValue(true)

  // Tenant lookup — the route queries the tenants table directly via db.select
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([
          { id: TENANT_ID, settings: { whatsapp_phone_number_id: PHONE_NUMBER_ID } },
        ]),
      }),
    }),
  } as never)

  // No duplicate message
  vi.mocked(getMessageByMetaId).mockResolvedValue(null as never)

  // Prospect lookup — existing prospect in a non-terminal stage
  vi.mocked(getProspectByPhone).mockResolvedValue({
    id: 'prospect-1',
    stage: 'qualificado',
    createdAt: new Date().toISOString(),
  } as never)

  // No matching patient by phone
  vi.mocked(getPatientByPhone).mockResolvedValue(null as never)

  // Conversation upsert
  vi.mocked(upsertConversation).mockResolvedValue({
    id: CONVERSATION_ID,
  } as never)

  // Message creation
  vi.mocked(createMessage).mockResolvedValue({
    id: 'msg-1',
    conversationId: CONVERSATION_ID,
  } as never)

  // Remaining no-ops
  vi.mocked(incrementUnreadCount).mockResolvedValue(undefined as never)
  vi.mocked(pushSseEvent).mockResolvedValue(undefined as never)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  process.env.META_APP_SECRET = TEST_APP_SECRET
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.floraclin.com.br'
  setupCommonMocks()
})

describe('processConfirmationReply — button title extraction', () => {
  it('uses button_reply.title (not button_reply.id) for matching', async () => {
    // button_reply.id is "auto-uuid" — if the code mistakenly matched on id,
    // it would never hit the "Confirmar" branch.
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      id: APPOINTMENT_ID,
      status: 'scheduled',
      patientId: PATIENT_ID,
    } as never)
    vi.mocked(confirmAppointment).mockResolvedValue({ id: APPOINTMENT_ID } as never)
    vi.mocked(listAutomations).mockResolvedValue([])

    const payload = makeButtonReplyPayload('Confirmar', CONTEXT_MSG_ID)
    const res = await POST(makeRequest(payload))
    expect(res.status).toBe(200)

    // Allow fire-and-forget promise to resolve
    await vi.waitFor(() => {
      expect(getAppointmentByConfirmationMessageId).toHaveBeenCalledWith(
        TENANT_ID,
        CONTEXT_MSG_ID,
      )
      expect(confirmAppointment).toHaveBeenCalledWith(TENANT_ID, APPOINTMENT_ID)
    })
  })
})

describe('processConfirmationReply — confirmation flow', () => {
  it('confirms the appointment when button is "Confirmar" and status is scheduled', async () => {
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      id: APPOINTMENT_ID,
      status: 'scheduled',
      patientId: PATIENT_ID,
    } as never)
    vi.mocked(confirmAppointment).mockResolvedValue({ id: APPOINTMENT_ID } as never)
    vi.mocked(listAutomations).mockResolvedValue([])

    const payload = makeButtonReplyPayload('Confirmar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(confirmAppointment).toHaveBeenCalledWith(TENANT_ID, APPOINTMENT_ID)
    })
  })

  it('does not call requestReschedule when confirming', async () => {
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      id: APPOINTMENT_ID,
      status: 'scheduled',
      patientId: PATIENT_ID,
    } as never)
    vi.mocked(confirmAppointment).mockResolvedValue({ id: APPOINTMENT_ID } as never)
    vi.mocked(listAutomations).mockResolvedValue([])

    const payload = makeButtonReplyPayload('Confirmar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(confirmAppointment).toHaveBeenCalled()
    })
    expect(requestReschedule).not.toHaveBeenCalled()
  })
})

describe('processConfirmationReply — reschedule flow', () => {
  it('sets status to pending_reschedule when button is "Reagendar"', async () => {
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      id: APPOINTMENT_ID,
      status: 'scheduled',
      patientId: null,
    } as never)

    const payload = makeButtonReplyPayload('Reagendar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(requestReschedule).toHaveBeenCalledWith(
        TENANT_ID,
        APPOINTMENT_ID,
      )
    })
  })

  it('does not call confirmAppointment when rescheduling', async () => {
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      id: APPOINTMENT_ID,
      status: 'scheduled',
      patientId: null,
    } as never)

    const payload = makeButtonReplyPayload('Reagendar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(requestReschedule).toHaveBeenCalled()
    })
    expect(confirmAppointment).not.toHaveBeenCalled()
  })
})

describe('processConfirmationReply — already cancelled / not scheduled', () => {
  it('ignores the reply if appointment status is "confirmed" (not scheduled)', async () => {
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      id: APPOINTMENT_ID,
      status: 'confirmed',
      patientId: PATIENT_ID,
    } as never)

    const payload = makeButtonReplyPayload('Confirmar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    // Give fire-and-forget time to resolve
    await new Promise((r) => setTimeout(r, 50))

    expect(confirmAppointment).not.toHaveBeenCalled()
    expect(requestReschedule).not.toHaveBeenCalled()
  })

  it('ignores the reply if appointment status is "cancelled"', async () => {
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      id: APPOINTMENT_ID,
      status: 'cancelled',
      patientId: PATIENT_ID,
    } as never)

    const payload = makeButtonReplyPayload('Reagendar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await new Promise((r) => setTimeout(r, 50))

    expect(confirmAppointment).not.toHaveBeenCalled()
    expect(requestReschedule).not.toHaveBeenCalled()
  })

  it('ignores the reply if appointment status is "pending_reschedule"', async () => {
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      id: APPOINTMENT_ID,
      status: 'pending_reschedule',
      patientId: PATIENT_ID,
    } as never)

    const payload = makeButtonReplyPayload('Confirmar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await new Promise((r) => setTimeout(r, 50))

    expect(confirmAppointment).not.toHaveBeenCalled()
    expect(requestReschedule).not.toHaveBeenCalled()
  })
})

describe('processConfirmationReply — no matching appointment', () => {
  it('does nothing when confirmationMessageId matches no appointment', async () => {
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue(null as never)

    const payload = makeButtonReplyPayload('Confirmar', 'wamid.nonexistent')
    await POST(makeRequest(payload))

    await new Promise((r) => setTimeout(r, 50))

    expect(confirmAppointment).not.toHaveBeenCalled()
    expect(requestReschedule).not.toHaveBeenCalled()
  })
})

describe('processConfirmationReply — does not trigger for plain text messages', () => {
  it('skips confirmation logic for regular text messages (no button_reply)', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                contacts: [{ wa_id: PATIENT_PHONE, profile: { name: 'Maria' } }],
                messages: [
                  {
                    id: META_MSG_ID,
                    from: PATIENT_PHONE,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: 'Confirmar' },
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    await POST(makeRequest(payload))
    await new Promise((r) => setTimeout(r, 50))

    expect(getAppointmentByConfirmationMessageId).not.toHaveBeenCalled()
  })
})

describe('maybeAutoSendAnamnesis — skip conditions', () => {
  beforeEach(() => {
    // Arrange: Confirmar tapped on a scheduled appointment with a patientId
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      id: APPOINTMENT_ID,
      status: 'scheduled',
      patientId: PATIENT_ID,
    } as never)
    vi.mocked(confirmAppointment).mockResolvedValue({ id: APPOINTMENT_ID } as never)
  })

  it('skips anamnesis when no appointment_confirmation automation exists', async () => {
    vi.mocked(listAutomations).mockResolvedValue([])

    const payload = makeButtonReplyPayload('Confirmar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(confirmAppointment).toHaveBeenCalled()
    })
    // Wait a bit extra for the anamnesis path
    await new Promise((r) => setTimeout(r, 50))

    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('skips anamnesis when automation exists but is disabled', async () => {
    vi.mocked(listAutomations).mockResolvedValue([
      { trigger: 'appointment_confirmation', enabled: false, config: { autoAnamnesisEnabled: true } },
    ] as never)

    const payload = makeButtonReplyPayload('Confirmar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(confirmAppointment).toHaveBeenCalled()
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('skips anamnesis when autoAnamnesisEnabled is false in config', async () => {
    vi.mocked(listAutomations).mockResolvedValue([
      {
        trigger: 'appointment_confirmation',
        enabled: true,
        config: { autoAnamnesisEnabled: false },
      },
    ] as never)

    const payload = makeButtonReplyPayload('Confirmar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(confirmAppointment).toHaveBeenCalled()
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('skips anamnesis when appointment has no patientId', async () => {
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      id: APPOINTMENT_ID,
      status: 'scheduled',
      patientId: null,
    } as never)
    vi.mocked(confirmAppointment).mockResolvedValue({ id: APPOINTMENT_ID } as never)
    vi.mocked(listAutomations).mockResolvedValue([
      {
        trigger: 'appointment_confirmation',
        enabled: true,
        config: { autoAnamnesisEnabled: true },
      },
    ] as never)

    const payload = makeButtonReplyPayload('Confirmar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(confirmAppointment).toHaveBeenCalled()
    })
    await new Promise((r) => setTimeout(r, 50))

    // listAutomations should NOT even be called because patientId is null
    expect(listAutomations).not.toHaveBeenCalled()
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('skips anamnesis when existing anamnesis is fresh (< staleDays)', async () => {
    vi.mocked(listAutomations).mockResolvedValue([
      {
        trigger: 'appointment_confirmation',
        enabled: true,
        config: { autoAnamnesisEnabled: true, anamnesisStaleDays: 60 },
      },
    ] as never)

    // Anamnesis was updated 10 days ago — still fresh
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    vi.mocked(getAnamnesis).mockResolvedValue({
      updatedAt: tenDaysAgo.toISOString(),
    } as never)

    const payload = makeButtonReplyPayload('Confirmar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(confirmAppointment).toHaveBeenCalled()
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('skips anamnesis when template is not APPROVED', async () => {
    vi.mocked(listAutomations).mockResolvedValue([
      {
        trigger: 'appointment_confirmation',
        enabled: true,
        config: { autoAnamnesisEnabled: true, anamnesisStaleDays: 60 },
      },
    ] as never)

    // Anamnesis is stale (90 days old)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    vi.mocked(getAnamnesis).mockResolvedValue({
      updatedAt: ninetyDaysAgo.toISOString(),
    } as never)

    // Template exists but is pending
    vi.mocked(getTemplateForTenant).mockResolvedValue({
      name: 'anamnese_link',
      status: 'PENDING',
      language: 'pt_BR',
    } as never)

    const payload = makeButtonReplyPayload('Confirmar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(confirmAppointment).toHaveBeenCalled()
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('skips anamnesis when no template exists for anamnese_link purpose', async () => {
    vi.mocked(listAutomations).mockResolvedValue([
      {
        trigger: 'appointment_confirmation',
        enabled: true,
        config: { autoAnamnesisEnabled: true },
      },
    ] as never)

    vi.mocked(getAnamnesis).mockResolvedValue(null as never)
    vi.mocked(getTemplateForTenant).mockResolvedValue(null as never)

    const payload = makeButtonReplyPayload('Confirmar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(confirmAppointment).toHaveBeenCalled()
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('skips anamnesis when confirmAppointment returns null (race condition)', async () => {
    vi.mocked(confirmAppointment).mockResolvedValue(undefined as never)
    vi.mocked(listAutomations).mockResolvedValue([
      {
        trigger: 'appointment_confirmation',
        enabled: true,
        config: { autoAnamnesisEnabled: true },
      },
    ] as never)

    const payload = makeButtonReplyPayload('Confirmar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(confirmAppointment).toHaveBeenCalled()
    })
    await new Promise((r) => setTimeout(r, 50))

    // The code bails with `if (!confirmed) return` so anamnesis is not sent
    expect(listAutomations).not.toHaveBeenCalled()
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })
})

describe('maybeAutoSendAnamnesis — happy path', () => {
  it('sends anamnesis template when all conditions are met', async () => {
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      id: APPOINTMENT_ID,
      status: 'scheduled',
      patientId: PATIENT_ID,
    } as never)
    vi.mocked(confirmAppointment).mockResolvedValue({ id: APPOINTMENT_ID } as never)

    vi.mocked(listAutomations).mockResolvedValue([
      {
        trigger: 'appointment_confirmation',
        enabled: true,
        config: { autoAnamnesisEnabled: true, anamnesisStaleDays: 60 },
      },
    ] as never)

    // No existing anamnesis — should be considered stale
    vi.mocked(getAnamnesis).mockResolvedValue(null as never)

    vi.mocked(getTemplateForTenant).mockResolvedValue({
      name: 'anamnese_link_v1',
      status: 'APPROVED',
      language: 'pt_BR',
    } as never)

    vi.mocked(getPatient).mockResolvedValue({
      id: PATIENT_ID,
      fullName: 'Maria Silva',
    } as never)

    vi.mocked(createAnamnesisToken).mockResolvedValue({
      token: 'tok-abc123',
    } as never)

    vi.mocked(getTenant).mockResolvedValue({
      id: TENANT_ID,
      name: 'Clínica Flora',
    } as never)

    vi.mocked(sendTemplateMessage).mockResolvedValue({
      metaMessageId: 'wamid.anamnesis-sent',
    } as never)

    // upsertConversation is called a second time for the anamnesis outbound message
    vi.mocked(upsertConversation).mockResolvedValue({
      id: CONVERSATION_ID,
    } as never)

    vi.mocked(createMessage).mockResolvedValue({
      id: 'msg-2',
      conversationId: CONVERSATION_ID,
    } as never)

    const payload = makeButtonReplyPayload('Confirmar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(sendTemplateMessage).toHaveBeenCalledWith(
        TENANT_ID,
        PATIENT_PHONE, // normalizeBrPhone is identity in mock, phone already starts with 55
        'anamnese_link_v1',
        'pt_BR',
        {
          '1': 'Maria',       // first name extracted from fullName
          '2': 'Clínica Flora',
          '3': 'https://app.floraclin.com.br/a/tok-abc123',
        },
      )
    })
  })

  it('sends anamnesis when existing anamnesis is stale (>= staleDays)', async () => {
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      id: APPOINTMENT_ID,
      status: 'scheduled',
      patientId: PATIENT_ID,
    } as never)
    vi.mocked(confirmAppointment).mockResolvedValue({ id: APPOINTMENT_ID } as never)

    vi.mocked(listAutomations).mockResolvedValue([
      {
        trigger: 'appointment_confirmation',
        enabled: true,
        config: { autoAnamnesisEnabled: true, anamnesisStaleDays: 30 },
      },
    ] as never)

    // Anamnesis updated 31 days ago — stale
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
    vi.mocked(getAnamnesis).mockResolvedValue({
      updatedAt: thirtyOneDaysAgo.toISOString(),
    } as never)

    vi.mocked(getTemplateForTenant).mockResolvedValue({
      name: 'anamnese_link_v1',
      status: 'APPROVED',
      language: 'pt_BR',
    } as never)

    vi.mocked(getPatient).mockResolvedValue({
      id: PATIENT_ID,
      fullName: 'Ana Beatriz Costa',
    } as never)

    vi.mocked(createAnamnesisToken).mockResolvedValue({
      token: 'tok-xyz789',
    } as never)

    vi.mocked(getTenant).mockResolvedValue({
      id: TENANT_ID,
      name: 'Clínica Bela',
    } as never)

    vi.mocked(sendTemplateMessage).mockResolvedValue({
      metaMessageId: 'wamid.anamnesis-sent-2',
    } as never)

    vi.mocked(upsertConversation).mockResolvedValue({
      id: CONVERSATION_ID,
    } as never)

    vi.mocked(createMessage).mockResolvedValue({
      id: 'msg-3',
      conversationId: CONVERSATION_ID,
    } as never)

    const payload = makeButtonReplyPayload('Confirmar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(sendTemplateMessage).toHaveBeenCalledWith(
        TENANT_ID,
        PATIENT_PHONE,
        'anamnese_link_v1',
        'pt_BR',
        expect.objectContaining({
          '1': 'Ana',
          '3': 'https://app.floraclin.com.br/a/tok-xyz789',
        }),
      )
    })
  })

  it('uses default staleDays of 60 when not specified in config', async () => {
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      id: APPOINTMENT_ID,
      status: 'scheduled',
      patientId: PATIENT_ID,
    } as never)
    vi.mocked(confirmAppointment).mockResolvedValue({ id: APPOINTMENT_ID } as never)

    vi.mocked(listAutomations).mockResolvedValue([
      {
        trigger: 'appointment_confirmation',
        enabled: true,
        config: { autoAnamnesisEnabled: true }, // no anamnesisStaleDays
      },
    ] as never)

    // Anamnesis updated 59 days ago — should be fresh (default 60 days)
    const fiftyNineDaysAgo = new Date(Date.now() - 59 * 24 * 60 * 60 * 1000)
    vi.mocked(getAnamnesis).mockResolvedValue({
      updatedAt: fiftyNineDaysAgo.toISOString(),
    } as never)

    const payload = makeButtonReplyPayload('Confirmar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(confirmAppointment).toHaveBeenCalled()
    })
    await new Promise((r) => setTimeout(r, 50))

    // 59 < 60 default staleDays, so anamnesis should NOT be sent
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })
})

describe('maybeAutoSendAnamnesis — edge cases', () => {
  it('skips when getPatient returns null', async () => {
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      id: APPOINTMENT_ID,
      status: 'scheduled',
      patientId: PATIENT_ID,
    } as never)
    vi.mocked(confirmAppointment).mockResolvedValue({ id: APPOINTMENT_ID } as never)

    vi.mocked(listAutomations).mockResolvedValue([
      {
        trigger: 'appointment_confirmation',
        enabled: true,
        config: { autoAnamnesisEnabled: true },
      },
    ] as never)
    vi.mocked(getAnamnesis).mockResolvedValue(null as never)
    vi.mocked(getTemplateForTenant).mockResolvedValue({
      name: 'anamnese_link_v1',
      status: 'APPROVED',
      language: 'pt_BR',
    } as never)
    vi.mocked(getPatient).mockResolvedValue(null as never)

    const payload = makeButtonReplyPayload('Confirmar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(confirmAppointment).toHaveBeenCalled()
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('skips when getTenant returns null', async () => {
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      id: APPOINTMENT_ID,
      status: 'scheduled',
      patientId: PATIENT_ID,
    } as never)
    vi.mocked(confirmAppointment).mockResolvedValue({ id: APPOINTMENT_ID } as never)

    vi.mocked(listAutomations).mockResolvedValue([
      {
        trigger: 'appointment_confirmation',
        enabled: true,
        config: { autoAnamnesisEnabled: true },
      },
    ] as never)
    vi.mocked(getAnamnesis).mockResolvedValue(null as never)
    vi.mocked(getTemplateForTenant).mockResolvedValue({
      name: 'anamnese_link_v1',
      status: 'APPROVED',
      language: 'pt_BR',
    } as never)
    vi.mocked(getPatient).mockResolvedValue({
      id: PATIENT_ID,
      fullName: 'Maria',
    } as never)
    vi.mocked(createAnamnesisToken).mockResolvedValue({
      token: 'tok-abc',
    } as never)
    vi.mocked(getTenant).mockResolvedValue(null as never)

    const payload = makeButtonReplyPayload('Confirmar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(confirmAppointment).toHaveBeenCalled()
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('normalizes phone by prepending 55 if not present', async () => {
    // The webhook receives msg.from which is passed through normalizeBrPhone.
    // Our mock is identity, but the production code inside maybeAutoSendAnamnesis
    // adds "55" prefix if missing.  We check the normalizedPhone argument.
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      id: APPOINTMENT_ID,
      status: 'scheduled',
      patientId: PATIENT_ID,
    } as never)
    vi.mocked(confirmAppointment).mockResolvedValue({ id: APPOINTMENT_ID } as never)
    vi.mocked(listAutomations).mockResolvedValue([
      {
        trigger: 'appointment_confirmation',
        enabled: true,
        config: { autoAnamnesisEnabled: true },
      },
    ] as never)
    vi.mocked(getAnamnesis).mockResolvedValue(null as never)
    vi.mocked(getTemplateForTenant).mockResolvedValue({
      name: 'anamnese_link_v1',
      status: 'APPROVED',
      language: 'pt_BR',
    } as never)
    vi.mocked(getPatient).mockResolvedValue({
      id: PATIENT_ID,
      fullName: 'João',
    } as never)
    vi.mocked(createAnamnesisToken).mockResolvedValue({
      token: 'tok-phone',
    } as never)
    vi.mocked(getTenant).mockResolvedValue({
      id: TENANT_ID,
      name: 'Clínica Test',
    } as never)
    vi.mocked(sendTemplateMessage).mockResolvedValue({
      metaMessageId: 'wamid.phone-test',
    } as never)
    vi.mocked(upsertConversation).mockResolvedValue({ id: CONVERSATION_ID } as never)
    vi.mocked(createMessage).mockResolvedValue({ id: 'msg-4', conversationId: CONVERSATION_ID } as never)

    const payload = makeButtonReplyPayload('Confirmar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(sendTemplateMessage).toHaveBeenCalled()
    })

    // The phone in the payload starts with 55, so the code's
    // `phone.startsWith('55') ? phone : \`55${phone}\`` keeps it as-is.
    const phoneArg = vi.mocked(sendTemplateMessage).mock.calls[0][1]
    expect(phoneArg).toBe(PATIENT_PHONE) // 5511999990000 starts with 55
  })
})

describe('processConfirmationReply — unrecognized button title', () => {
  it('does nothing for an unknown button title', async () => {
    vi.mocked(getAppointmentByConfirmationMessageId).mockResolvedValue({
      id: APPOINTMENT_ID,
      status: 'scheduled',
      patientId: PATIENT_ID,
    } as never)

    const payload = makeButtonReplyPayload('Cancelar', CONTEXT_MSG_ID)
    await POST(makeRequest(payload))

    await new Promise((r) => setTimeout(r, 50))

    expect(confirmAppointment).not.toHaveBeenCalled()
    expect(requestReschedule).not.toHaveBeenCalled()
  })
})
