import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Rescheduling has to invalidate the confirmation that was already sent.
 *
 * The cron selects only appointments with a null confirmationSentAt, so a
 * stamp left over from the old slot means the patient never hears about the
 * new one. This surfaced in production: an appointment moved twice kept its
 * original stamp and the daily run reported zero sends while the clinic was
 * expecting one.
 */

const selectLimit = vi.fn()
const updateSet = vi.fn()

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: selectLimit })),
      })),
    })),
    update: vi.fn(() => ({
      set: updateSet,
    })),
  },
}))

vi.mock('@/db/schema', () => ({
  appointments: {
    id: 'id',
    tenantId: 'tenant_id',
    date: 'date',
    startTime: 'start_time',
    deletedAt: 'deleted_at',
    confirmationSentAt: 'confirmation_sent_at',
    confirmationMessageId: 'confirmation_message_id',
  },
  patients: {},
  practitioners: {},
  procedureTypes: {},
  users: {},
  tenants: {},
  calendarBlocks: {},
  procedureRecords: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...a: unknown[]) => a),
  and: vi.fn((...a: unknown[]) => a),
  or: vi.fn((...a: unknown[]) => a),
  ne: vi.fn((...a: unknown[]) => a),
  gte: vi.fn((...a: unknown[]) => a),
  lte: vi.fn((...a: unknown[]) => a),
  gt: vi.fn((...a: unknown[]) => a),
  lt: vi.fn((...a: unknown[]) => a),
  desc: vi.fn((a: unknown) => a),
  asc: vi.fn((a: unknown) => a),
  isNull: vi.fn((a: unknown) => a),
  isNotNull: vi.fn((a: unknown) => a),
  inArray: vi.fn((...a: unknown[]) => a),
  count: vi.fn(() => 'count'),
  sql: Object.assign(
    vi.fn(() => 'sql'),
    { join: vi.fn(() => 'sql') },
  ),
}))

import { updateAppointment } from '@/db/queries/appointments'

const TENANT = 'tenant-1'
const APPT = 'appt-1'
const CURRENT = { date: '2026-08-20', startTime: '14:00:00' }

/** The object handed to drizzle's .set(), which is what we assert on. */
function setPayload() {
  return updateSet.mock.calls[0][0] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  selectLimit.mockResolvedValue([CURRENT])
  updateSet.mockReturnValue({
    where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ id: APPT }]) })),
  })
})

describe('updateAppointment', () => {
  it('clears the confirmation when the date moves', async () => {
    await updateAppointment(TENANT, APPT, { date: '2026-08-21' })

    expect(setPayload()).toMatchObject({
      date: '2026-08-21',
      confirmationSentAt: null,
      confirmationMessageId: null,
    })
  })

  it('clears the confirmation when only the time moves', async () => {
    await updateAppointment(TENANT, APPT, { startTime: '16:00:00' })

    expect(setPayload()).toMatchObject({
      confirmationSentAt: null,
      confirmationMessageId: null,
    })
  })

  it('leaves the confirmation alone when the slot is unchanged', async () => {
    // The same route carries note and practitioner edits. Clearing here
    // would send the patient a second confirmation for a slot that did not
    // move.
    await updateAppointment(TENANT, APPT, { notes: 'trouxe exames' })

    const payload = setPayload()
    expect(payload).not.toHaveProperty('confirmationSentAt')
    expect(payload).not.toHaveProperty('confirmationMessageId')
  })

  it('leaves the confirmation alone when date and time are resent unchanged', async () => {
    // A form that submits every field on every save is the common case, and
    // it must not read as a reschedule.
    await updateAppointment(TENANT, APPT, {
      date: CURRENT.date,
      startTime: CURRENT.startTime,
      notes: 'sem alterações',
    })

    const payload = setPayload()
    expect(payload).not.toHaveProperty('confirmationSentAt')
    expect(payload).not.toHaveProperty('confirmationMessageId')
  })

  it('returns undefined and writes nothing when the appointment does not exist', async () => {
    selectLimit.mockResolvedValue([])

    const result = await updateAppointment(TENANT, 'missing', { date: '2026-08-21' })

    expect(result).toBeUndefined()
    expect(updateSet).not.toHaveBeenCalled()
  })
})
