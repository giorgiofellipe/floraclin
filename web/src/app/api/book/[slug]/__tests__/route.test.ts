/**
 * Public booking routes have no session and no middleware or
 * `getAuthContext` gate to identify the tenant -- they resolve it from the
 * URL slug and must check the subscription themselves. Both
 * `POST /api/book/[slug]` and `GET /api/book/[slug]/slots` reject with a 403
 * when the resolved tenant's subscription is inactive. The POST also books
 * only an offered slot, maps a lost race to 409 and limits bookings per IP.
 *
 * All DB access is mocked -- no network or database access occurs.
 *
 * The clock is frozen because the fixtures book a specific day. Without it
 * the suite passes until that day is in the past, and then fails on a date
 * nobody chose: the slots route refuses a day that has already been.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Mocks (hoisted by vitest) ────────────────────────────────────────

const { dbChain, pushDbResult, resetDbQueue } = vi.hoisted(() => {
  const queue: unknown[] = []
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.where = () => chain
  chain.innerJoin = () => chain
  chain.orderBy = () => chain
  chain.limit = () => Promise.resolve(queue.shift() ?? [])
  return {
    dbChain: chain,
    pushDbResult: (result: unknown) => queue.push(result),
    resetDbQueue: () => {
      queue.length = 0
    },
  }
})

vi.mock('@/db/client', () => ({
  db: { select: () => dbChain },
}))

vi.mock('@/db/schema', () => ({
  tenants: { id: 'id', slug: 'slug', deletedAt: 'deletedAt' },
  tenantUsers: {},
  users: {},
  appointments: {},
}))

vi.mock('@/db/queries/appointments', () => ({
  createAppointment: vi.fn().mockResolvedValue({
    id: 'appt-1',
    date: '2026-09-01',
    startTime: '10:00',
    endTime: '10:30',
  }),
  getAvailableSlots: vi.fn(),
}))

vi.mock('@/lib/plans', () => ({
  isSubscriptionActive: vi.fn(),
}))

// The booking POST also opens a CRM lead, records its attribution and queues
// the Meta Lead event. `book/__tests__/attribution.test.ts` asserts on what
// they receive; this suite only checks they are skipped when no booking is made.
vi.mock('@/db/queries/prospects', () => ({
  getProspectByPhone: vi.fn().mockResolvedValue(null),
  createNewProspect: vi.fn().mockResolvedValue({ id: 'prospect-1', stage: 'novo', convertedPatientId: null }),
  updateProspect: vi.fn().mockResolvedValue({ id: 'prospect-1', stage: 'agendado' }),
}))

vi.mock('@/db/queries/lead-attributions', () => ({
  recordAttribution: vi.fn().mockResolvedValue({ recorded: true }),
}))

vi.mock('@/lib/meta/events', () => ({
  enqueueMetaEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/api-error', () => ({
  handleApiError: vi.fn(
    async (_error: unknown, _request: unknown, options: { body: unknown }) =>
      new Response(JSON.stringify(options.body), { status: 500 })
  ),
}))

vi.mock('@/lib/logo', () => ({
  signLogoPath: vi.fn().mockResolvedValue(null),
}))

import { POST } from '../route'
import { GET as GET_SLOTS } from '../slots/route'
import { isSubscriptionActive } from '@/lib/plans'
import { createAppointment, getAvailableSlots } from '@/db/queries/appointments'
import { createNewProspect, getProspectByPhone } from '@/db/queries/prospects'
import { recordAttribution } from '@/db/queries/lead-attributions'
import { enqueueMetaEvent } from '@/lib/meta/events'
import { DrizzleQueryError } from 'drizzle-orm'

const TENANT_ROW = {
  id: 'tenant-1',
  name: 'Clínica Teste',
  slug: 'clinica-teste',
  logoUrl: null,
  phone: '11999999999',
  email: 'contato@clinica.com',
  workingHours: {},
  settings: { online_booking_enabled: true },
}

const PRACTITIONER_ID = '123e4567-e89b-12d3-a456-426614174000'

// Each request gets its own client IP unless a test passes one, so the per-IP limit stays out of unrelated tests.
let ipCounter = 0
function makeBookingRequest(body: unknown, ip = `10.0.0.${++ipCounter}`) {
  return new NextRequest('http://localhost/api/book/clinica-teste', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

const VALID_BOOKING_BODY = {
  name: 'Paciente Teste',
  phone: '11988887777',
  email: '',
  practitionerId: PRACTITIONER_ID,
  date: '2026-09-01',
  startTime: '10:00',
}

beforeEach(() => {
  resetDbQueue()
  vi.mocked(isSubscriptionActive).mockReset()
  vi.mocked(getAvailableSlots).mockReset().mockResolvedValue([
    { start: '10:00', end: '10:30' },
    { start: '10:30', end: '11:00' },
  ])
})

beforeAll(() => {
  vi.setSystemTime(new Date('2026-08-31T09:00:00.000Z'))
})

afterAll(() => {
  vi.useRealTimers()
})

describe('POST /api/book/[slug]', () => {
  it('returns 403 with the Portuguese message when the subscription is inactive', async () => {
    vi.mocked(isSubscriptionActive).mockResolvedValue(false)
    pushDbResult([TENANT_ROW])

    const res = await POST(makeBookingRequest(VALID_BOOKING_BODY), {
      params: Promise.resolve({ slug: 'clinica-teste' }),
    })

    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toBe(
      'Esta clínica não está aceitando agendamentos online no momento.'
    )
  })

  it('creates the appointment normally when the subscription is active', async () => {
    vi.mocked(isSubscriptionActive).mockResolvedValue(true)
    pushDbResult([TENANT_ROW]) // getTenantBySlug
    pushDbResult([]) // duplicate-booking check
    pushDbResult([{ id: PRACTITIONER_ID }]) // practitioner belongs to tenant

    const res = await POST(makeBookingRequest(VALID_BOOKING_BODY), {
      params: Promise.resolve({ slug: 'clinica-teste' }),
    })

    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  describe('only books a time the slots route offers', () => {
    beforeEach(() => {
      vi.mocked(isSubscriptionActive).mockResolvedValue(true)
      vi.mocked(createAppointment).mockClear()
      pushDbResult([TENANT_ROW]) // getTenantBySlug
      pushDbResult([]) // duplicate-booking check
      pushDbResult([{ id: PRACTITIONER_ID }]) // practitioner belongs to tenant
    })

    // The clock is 06:00 in São Paulo on 2026-08-31.
    it.each([
      ['a time earlier today', { date: '2026-08-31', startTime: '05:30' }],
      ['a time outside the offered slots', { startTime: '10:15' }],
    ])('refuses %s', async (_case, overrides) => {
      vi.mocked(getAvailableSlots).mockResolvedValue([
        { start: '05:30', end: '06:00' },
        { start: '10:00', end: '10:30' },
        { start: '10:30', end: '11:00' },
      ])

      const res = await POST(makeBookingRequest({ ...VALID_BOOKING_BODY, ...overrides }), {
        params: Promise.resolve({ slug: 'clinica-teste' }),
      })

      expect(res.status).toBe(409)
      expect((await res.json()).error).toBe('Este horário já não está mais disponível. Por favor, escolha outro.')
      expect(createAppointment).not.toHaveBeenCalled()
    })

    it('books an offered time with that slot\'s end', async () => {
      vi.mocked(getAvailableSlots).mockResolvedValue([{ start: '06:30', end: '07:00' }])

      const res = await POST(makeBookingRequest({ ...VALID_BOOKING_BODY, date: '2026-08-31', startTime: '06:30' }), {
        params: Promise.resolve({ slug: 'clinica-teste' }),
      })

      expect(res.status).toBe(201)
      expect(createAppointment).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ date: '2026-08-31', startTime: '06:30', endTime: '07:00' }),
      )
    })
  })
})

describe('POST /api/book/[slug] once the request is valid', () => {
  function queueValidBooking() {
    pushDbResult([TENANT_ROW]) // getTenantBySlug
    pushDbResult([]) // duplicate-booking check
    pushDbResult([{ id: PRACTITIONER_ID }]) // practitioner belongs to tenant
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isSubscriptionActive).mockResolvedValue(true)
  })

  it('answers 409 and opens no lead when another booking took the slot first', async () => {
    queueValidBooking()
    const overlap = Object.assign(new Error('conflicting key value violates exclusion constraint'), {
      code: '23P01',
      constraint_name: 'no_overlapping_appointments',
    })
    vi.mocked(createAppointment).mockRejectedValueOnce(new DrizzleQueryError('insert into appointments', [], overlap))

    const res = await POST(makeBookingRequest(VALID_BOOKING_BODY), {
      params: Promise.resolve({ slug: 'clinica-teste' }),
    })

    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Este horário já não está mais disponível. Por favor, escolha outro.')
    expect(getProspectByPhone).not.toHaveBeenCalled()
    expect(createNewProspect).not.toHaveBeenCalled()
    expect(recordAttribution).not.toHaveBeenCalled()
    expect(enqueueMetaEvent).not.toHaveBeenCalled()
  })

  it('refuses a sixth booking from one IP within the hour, and not another IP', async () => {
    const book = (ip: string, n: number) => {
      queueValidBooking()
      return POST(makeBookingRequest({ ...VALID_BOOKING_BODY, phone: `119888800${n}` }, ip), {
        params: Promise.resolve({ slug: 'clinica-teste' }),
      })
    }
    for (let n = 0; n < 5; n++) {
      expect((await book('203.0.113.7', n)).status).toBe(201)
    }

    const refused = await book('203.0.113.7', 5)
    const otherIp = await book('203.0.113.8', 6)

    expect(refused.status).toBe(429)
    expect((await refused.json()).error).toBe(
      'Muitos agendamentos feitos a partir desta conexão. Aguarde um pouco antes de tentar novamente.',
    )
    expect(createAppointment).toHaveBeenCalledTimes(6)
    expect(otherIp.status).toBe(201)
  })
})

describe('GET /api/book/[slug]/slots', () => {
  function makeSlotsRequest() {
    return new NextRequest(
      `http://localhost/api/book/clinica-teste/slots?practitioner_id=${PRACTITIONER_ID}&date=2026-09-01`
    )
  }

  it('returns 403 with the Portuguese message when the subscription is inactive', async () => {
    vi.mocked(isSubscriptionActive).mockResolvedValue(false)
    pushDbResult([{ id: 'tenant-1', settings: { online_booking_enabled: true } }])

    const res = await GET_SLOTS(makeSlotsRequest(), {
      params: Promise.resolve({ slug: 'clinica-teste' }),
    })

    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toBe(
      'Esta clínica não está aceitando agendamentos online no momento.'
    )
  })

  it('returns available slots normally when the subscription is active', async () => {
    vi.mocked(isSubscriptionActive).mockResolvedValue(true)
    pushDbResult([{ id: 'tenant-1', settings: { online_booking_enabled: true } }])

    const res = await GET_SLOTS(makeSlotsRequest(), {
      params: Promise.resolve({ slug: 'clinica-teste' }),
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.slots).toHaveLength(2)
  })
})
