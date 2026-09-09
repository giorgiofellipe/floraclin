/**
 * Public booking routes have no session and no middleware or
 * `getAuthContext` gate to identify the tenant -- they resolve it from the
 * URL slug and must check the subscription themselves. These tests cover
 * that gate: `POST /api/book/[slug]` (creates the appointment) and
 * `GET /api/book/[slug]/slots` (lists open times) both reject with a 403
 * and a Portuguese message when the resolved tenant's subscription is
 * inactive, and behave normally otherwise.
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
  checkTimeConflict: vi.fn().mockResolvedValue(false),
  createAppointment: vi.fn().mockResolvedValue({
    id: 'appt-1',
    date: '2026-09-01',
    startTime: '10:00',
    endTime: '10:30',
  }),
  getAvailableSlots: vi.fn().mockResolvedValue([
    { start: '10:00', end: '10:30' },
    { start: '10:30', end: '11:00' },
  ]),
}))

vi.mock('@/lib/plans', () => ({
  isSubscriptionActive: vi.fn(),
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

function makeBookingRequest(body: unknown) {
  return new NextRequest('http://localhost/api/book/clinica-teste', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
