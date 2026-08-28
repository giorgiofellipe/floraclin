/**
 * Booking page prospect creation and website attribution.
 *
 * The dangerous path here is a phone that already has an active WhatsApp
 * lead booking online: `prospects` carries a partial unique index on
 * (tenant_id, phone) WHERE stage NOT IN ('convertido', 'perdido'), so an
 * unconditional createNewProspect raises 23505 and the route's catch turns
 * it into a 500. See docs/plans/2026-08-28-meta-conversions-cook.md, Task D6.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const TENANT_ID = 'tenant-1'
const PRACTITIONER_ID = '11111111-1111-4111-8111-111111111111'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  const passthrough = ['from', 'where', 'limit', 'innerJoin', 'orderBy']
  for (const method of passthrough) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (resolve: (value: unknown) => void) => resolve(result)
  return chain
}

const { selectMock } = vi.hoisted(() => ({ selectMock: vi.fn() }))

vi.mock('@/db/client', () => ({
  db: { select: selectMock },
}))

vi.mock('@/db/queries/appointments', () => ({
  checkTimeConflict: vi.fn(async () => false),
  createAppointment: vi.fn(async (_tenantId: string, data: Record<string, unknown>) => ({
    id: 'appt-1',
    date: data.date,
    startTime: data.startTime,
    endTime: data.endTime,
  })),
}))

vi.mock('@/db/queries/prospects', () => ({
  getProspectByPhone: vi.fn(),
  createNewProspect: vi.fn(),
  updateProspect: vi.fn(),
}))

vi.mock('@/db/queries/lead-attributions', () => ({
  recordAttribution: vi.fn(async () => ({ recorded: true })),
}))

vi.mock('@/lib/meta/events', () => ({
  enqueueMetaEvent: vi.fn(async () => {}),
}))

// buildFbc is real: it's a pure function and one of the tests below asserts
// on its exact output shape.

import { POST } from '../[slug]/route'
import { getProspectByPhone, createNewProspect, updateProspect } from '@/db/queries/prospects'
import { recordAttribution } from '@/db/queries/lead-attributions'
import { enqueueMetaEvent } from '@/lib/meta/events'
import { createAppointment } from '@/db/queries/appointments'

const getProspectByPhoneMock = getProspectByPhone as unknown as ReturnType<typeof vi.fn>
const createNewProspectMock = createNewProspect as unknown as ReturnType<typeof vi.fn>
const updateProspectMock = updateProspect as unknown as ReturnType<typeof vi.fn>
const recordAttributionMock = recordAttribution as unknown as ReturnType<typeof vi.fn>
const enqueueMetaEventMock = enqueueMetaEvent as unknown as ReturnType<typeof vi.fn>
const createAppointmentMock = createAppointment as unknown as ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tenantRow() {
  return {
    id: TENANT_ID,
    name: 'Clinica Teste',
    slug: 'clinica-teste',
    logoUrl: null,
    phone: null,
    email: null,
    workingHours: {},
    settings: { online_booking_enabled: true },
  }
}

/** Queues the three db.select calls the route makes on a successful path:
 * tenant lookup, the recent-duplicate-booking check, then the practitioner
 * ownership check. */
function queueSelects() {
  selectMock
    .mockReturnValueOnce(makeChain([tenantRow()]))
    .mockReturnValueOnce(makeChain([]))
    .mockReturnValueOnce(makeChain([{ id: PRACTITIONER_ID }]))
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/book/clinica-teste', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function bookingBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Maria Silva',
    phone: '11999998888',
    email: 'maria@example.com',
    practitionerId: PRACTITIONER_ID,
    date: '2026-09-01',
    startTime: '10:00',
    ...overrides,
  }
}

function post(body: Record<string, unknown>) {
  return POST(makeRequest(body), { params: Promise.resolve({ slug: 'clinica-teste' }) })
}

function newProspectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prospect-1',
    tenantId: TENANT_ID,
    phone: '11999998888',
    name: 'Maria Silva',
    stage: 'novo',
    ...overrides,
  }
}

describe('POST /api/book/[slug] attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateProspectMock.mockResolvedValue({ id: 'prospect-1', stage: 'agendado' })
    recordAttributionMock.mockResolvedValue({ recorded: true })
  })

  it('creates a prospect at agendado', async () => {
    queueSelects()
    getProspectByPhoneMock.mockResolvedValueOnce(null)
    createNewProspectMock.mockResolvedValueOnce(newProspectRow())

    const res = await post(bookingBody())

    expect(res.status).toBe(201)
    expect(createNewProspectMock).toHaveBeenCalledWith(TENANT_ID, {
      phone: '11999998888',
      name: 'Maria Silva',
      source: 'booking_page',
    })
    expect(updateProspectMock).toHaveBeenCalledWith(TENANT_ID, 'prospect-1', { stage: 'agendado' })
    expect(createAppointmentMock).toHaveBeenCalled()
  })

  it('reuses an existing active lead and returns 201, not 500', async () => {
    queueSelects()
    getProspectByPhoneMock.mockResolvedValueOnce(
      newProspectRow({ id: 'prospect-existing', name: 'Maria (via WhatsApp)', stage: 'contatado' }),
    )

    const res = await post(bookingBody())
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.success).toBe(true)
    expect(createNewProspectMock).not.toHaveBeenCalled()
    expect(updateProspectMock).toHaveBeenCalledWith(TENANT_ID, 'prospect-existing', { stage: 'agendado' })
  })

  it('stores a well-formed fbc when the booking carries an fbclid', async () => {
    queueSelects()
    getProspectByPhoneMock.mockResolvedValueOnce(null)
    createNewProspectMock.mockResolvedValueOnce(newProspectRow())

    await post(bookingBody({ fbclid: 'abc123', fbp: 'fb.1.1700000000000.987654321' }))

    expect(recordAttributionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        prospectId: 'prospect-1',
        channel: 'booking_page',
        fbclid: 'abc123',
        fbp: 'fb.1.1700000000000.987654321',
        fbc: expect.stringMatching(/^fb\.1\.\d+\.abc123$/),
      }),
    )
  })

  it('still creates the prospect and attribution with channel booking_page when there is no fbclid', async () => {
    queueSelects()
    getProspectByPhoneMock.mockResolvedValueOnce(null)
    createNewProspectMock.mockResolvedValueOnce(newProspectRow())

    const res = await post(bookingBody())

    expect(res.status).toBe(201)
    expect(recordAttributionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'booking_page',
        fbclid: null,
        fbp: null,
        fbc: null,
      }),
    )
    expect(enqueueMetaEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        eventName: 'Lead',
        eventId: 'lead:prospect-1',
        prospectId: 'prospect-1',
        actionSource: 'website',
        contact: { phone: '11999998888', fullName: 'Maria Silva', email: 'maria@example.com' },
      }),
    )
  })

  it('does not create a second attribution row on a repeat booking from the same phone', async () => {
    const store = new Map<string, unknown>()
    recordAttributionMock.mockImplementation(async (input: { prospectId: string }) => {
      if (store.has(input.prospectId)) return { recorded: false }
      store.set(input.prospectId, input)
      return { recorded: true }
    })

    // First booking: no prospect yet, one gets created and attributed.
    queueSelects()
    getProspectByPhoneMock.mockResolvedValueOnce(null)
    createNewProspectMock.mockResolvedValueOnce(newProspectRow())
    const first = await post(bookingBody())
    expect(first.status).toBe(201)

    // Second booking from the same phone: the prospect already exists.
    queueSelects()
    getProspectByPhoneMock.mockResolvedValueOnce(newProspectRow({ stage: 'agendado' }))
    const second = await post(bookingBody())
    expect(second.status).toBe(201)

    expect(recordAttributionMock).toHaveBeenCalledTimes(2)
    expect(await recordAttributionMock.mock.results[0].value).toEqual({ recorded: true })
    expect(await recordAttributionMock.mock.results[1].value).toEqual({ recorded: false })
    expect(store.size).toBe(1)
  })
})
