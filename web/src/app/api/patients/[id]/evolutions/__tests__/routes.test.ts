/**
 * Route-handler tests for the patient-evolutions endpoints.
 *
 * The service-layer tests in `web/src/lib/__tests__/patient-evolutions.test.ts`
 * already cover the transactional behavior — these tests fill the gap the
 * adversarial review flagged:
 *   - RA-6: invalid payloads to POST/PATCH/DELETE map to 400, not 500.
 *   - RA-1: when the service throws `EVOLUTION_NOTE_NOT_FOUND` (cross-patient
 *     id guess), the HTTP layer maps it to 404 — not 409, not 500.
 *
 * We mock the auth boundary and every collaborator, then invoke the route
 * handlers directly with synthesized `Request` + params, so this suite stays
 * a pure-unit test (no DB, no Next runtime spin-up).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks (hoisted by vitest) ────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(),
}))

vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn(),
}))

vi.mock('@/lib/patient-evolutions', () => ({
  createNote: vi.fn(),
  editNote: vi.fn(),
  softDeleteNote: vi.fn(),
}))

vi.mock('@/db/queries/patient-evolutions', () => ({
  listRevisions: vi.fn(),
  // The route under test only imports `listRevisions`, but the module exports
  // many functions — stub the rest as no-ops so the import resolves cleanly
  // if Next pulls them in transitively.
  getPatientEvolutionFeed: vi.fn(),
  getNoteLockedForUpdate: vi.fn(),
  insertRevisionSnapshot: vi.fn(),
  updateNoteFields: vi.fn(),
  softDeleteNote: vi.fn(),
  insertNote: vi.fn(),
}))

// All write/read routes now verify the patient belongs to the caller's tenant
// before doing any work (defense-in-depth on top of the existing tenant-scoped
// queries). Tests mock this to a "found" patient by default.
vi.mock('@/db/queries/patients', () => ({
  getPatient: vi.fn(),
}))

// ─── Imports under test (after mocks) ─────────────────────────────────

import { requireRole } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { BusinessError } from '@/lib/errors'
import {
  createNote,
  editNote,
  softDeleteNote,
} from '@/lib/patient-evolutions'
import { listRevisions } from '@/db/queries/patient-evolutions'
import { getPatient } from '@/db/queries/patients'

import { POST } from '../route'
import { DELETE, PATCH } from '../[noteId]/route'
import { GET as GET_REVISIONS } from '../[noteId]/revisions/route'

// ─── Helpers ──────────────────────────────────────────────────────────

const AUTH_OK = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  role: 'practitioner' as const,
  email: 'practitioner@example.com',
  fullName: 'Practitioner Example',
  isPlatformAdmin: false,
}

/**
 * Build a Request with a JSON body. Routes call `req.json()` — without a
 * real body the parse throws and the route surfaces a 500, masking the
 * validation behavior we actually care about.
 */
function jsonRequest(url: string, body: unknown, method: string): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function paramsOf<T extends object>(value: T): Promise<T> {
  return Promise.resolve(value)
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset()
  vi.mocked(requireWrite).mockReset()
  vi.mocked(createNote).mockReset()
  vi.mocked(editNote).mockReset()
  vi.mocked(softDeleteNote).mockReset()
  vi.mocked(listRevisions).mockReset()
  vi.mocked(getPatient).mockReset()

  // Default auth passes — individual tests can override.
  // requireRole backs the GET (revisions) route, which is read-only and was
  // deliberately left off the write gate.
  vi.mocked(requireRole).mockResolvedValue(AUTH_OK)
  // requireWrite backs the POST/PATCH/DELETE routes.
  vi.mocked(requireWrite).mockResolvedValue({ ctx: AUTH_OK, blocked: null })
  // Default patient existence check passes — tests that want a 404 cross-tenant
  // path explicitly override this with `mockResolvedValueOnce(null)`.
  vi.mocked(getPatient).mockResolvedValue({ id: 'p1' } as never)
})

// ─── POST /api/patients/[id]/evolutions ───────────────────────────────

describe('POST /api/patients/[id]/evolutions', () => {
  it('RA-6: returns 400 with issues when body is empty/missing', async () => {
    // Empty body string fails the `min(1)` constraint.
    const req = jsonRequest(
      'http://localhost/api/patients/p1/evolutions',
      { body: '' },
      'POST',
    )

    const res = await POST(req, { params: paramsOf({ id: 'p1' }) })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Validation failed')
    expect(json.issues).toBeTruthy()
    // Service must NEVER run when validation fails — otherwise we'd swallow
    // a 500 by accident and the user would see a stale error message.
    expect(createNote).not.toHaveBeenCalled()
  })

  it('RA-6: returns 400 when body exceeds max length', async () => {
    // EVOLUTION_BODY_MAX is 10_000; one over the cap should reject.
    const tooLong = 'x'.repeat(10_001)
    const req = jsonRequest(
      'http://localhost/api/patients/p1/evolutions',
      { body: tooLong },
      'POST',
    )

    const res = await POST(req, { params: paramsOf({ id: 'p1' }) })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Validation failed')
    expect(createNote).not.toHaveBeenCalled()
  })

  it('returns 404 when patient is not in caller tenant (cross-tenant guess)', async () => {
    // `getPatient` is tenant-scoped and returns null for any id that doesn't
    // belong to the caller's tenant. Without this guard the route would have
    // happily inserted a note for an arbitrary patient UUID.
    vi.mocked(getPatient).mockResolvedValueOnce(null)

    const req = jsonRequest(
      'http://localhost/api/patients/p1/evolutions',
      { body: 'a note for someone else' },
      'POST',
    )

    const res = await POST(req, { params: paramsOf({ id: 'p1' }) })

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Paciente não encontrado')
    expect(createNote).not.toHaveBeenCalled()
  })

  it('returns 400 when request body is not valid JSON', async () => {
    // `req.json()` throws — without the wrap the route 500s.
    const req = new Request('http://localhost/api/patients/p1/evolutions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    })

    const res = await POST(req, { params: paramsOf({ id: 'p1' }) })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('JSON inválido')
    expect(createNote).not.toHaveBeenCalled()
  })

  it('returns 201 with note on valid payload', async () => {
    const fakeNote = {
      id: 'note-new',
      tenantId: 'tenant-1',
      patientId: 'p1',
      body: 'a clinical note',
      authorId: 'user-1',
    }
    vi.mocked(createNote).mockResolvedValueOnce(fakeNote as never)

    const req = jsonRequest(
      'http://localhost/api/patients/p1/evolutions',
      { body: 'a clinical note' },
      'POST',
    )

    const res = await POST(req, { params: paramsOf({ id: 'p1' }) })

    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json).toEqual({ note: fakeNote })
    expect(createNote).toHaveBeenCalledTimes(1)
    expect(createNote).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      patientId: 'p1',
      authorId: 'user-1',
      body: 'a clinical note',
      occurredAt: null,
    })
  })
})

// ─── PATCH /api/patients/[id]/evolutions/[noteId] ─────────────────────

describe('PATCH /api/patients/[id]/evolutions/[noteId]', () => {
  it('RA-6: returns 400 on invalid payload', async () => {
    // Missing `body` field entirely — schema requires it.
    const req = jsonRequest(
      'http://localhost/api/patients/p1/evolutions/n1',
      {},
      'PATCH',
    )

    const res = await PATCH(req, {
      params: paramsOf({ id: 'p1', noteId: 'n1' }),
    })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Validation failed')
    expect(editNote).not.toHaveBeenCalled()
  })

  it('RA-1: returns 404 when service throws EVOLUTION_NOTE_NOT_FOUND', async () => {
    // Simulates a cross-patient ID guess: validation passes, then the service
    // lock misses because the note doesn't belong to this patient/tenant.
    vi.mocked(editNote).mockRejectedValueOnce(
      new BusinessError('EVOLUTION_NOTE_NOT_FOUND', 'Evolução não encontrada'),
    )

    const req = jsonRequest(
      'http://localhost/api/patients/p1/evolutions/n1',
      { body: 'updated body' },
      'PATCH',
    )

    const res = await PATCH(req, {
      params: paramsOf({ id: 'p1', noteId: 'n1' }),
    })

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Nota não encontrada')
  })
})

// ─── DELETE /api/patients/[id]/evolutions/[noteId] ────────────────────

describe('DELETE /api/patients/[id]/evolutions/[noteId]', () => {
  it('RA-6: returns 400 when reason is missing', async () => {
    // Schema requires non-empty `reason` — empty string is rejected.
    const req = jsonRequest(
      'http://localhost/api/patients/p1/evolutions/n1',
      { reason: '' },
      'DELETE',
    )

    const res = await DELETE(req, {
      params: paramsOf({ id: 'p1', noteId: 'n1' }),
    })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Validation failed')
    expect(softDeleteNote).not.toHaveBeenCalled()
  })

  it('returns 204 on success', async () => {
    vi.mocked(softDeleteNote).mockResolvedValueOnce(undefined as never)

    const req = jsonRequest(
      'http://localhost/api/patients/p1/evolutions/n1',
      { reason: 'duplicado' },
      'DELETE',
    )

    const res = await DELETE(req, {
      params: paramsOf({ id: 'p1', noteId: 'n1' }),
    })

    expect(res.status).toBe(204)
    expect(softDeleteNote).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      patientId: 'p1',
      noteId: 'n1',
      deletedBy: 'user-1',
      deleteReason: 'duplicado',
    })
  })

  it('RA-1: returns 404 when service throws EVOLUTION_NOTE_NOT_FOUND', async () => {
    vi.mocked(softDeleteNote).mockRejectedValueOnce(
      new BusinessError('EVOLUTION_NOTE_NOT_FOUND', 'Evolução não encontrada'),
    )

    const req = jsonRequest(
      'http://localhost/api/patients/p1/evolutions/n1',
      { reason: 'wrong patient' },
      'DELETE',
    )

    const res = await DELETE(req, {
      params: paramsOf({ id: 'p1', noteId: 'n1' }),
    })

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Nota não encontrada')
  })
})

// ─── GET /api/patients/[id]/evolutions/[noteId]/revisions ─────────────

describe('GET /api/patients/[id]/evolutions/[noteId]/revisions', () => {
  it('RA-1: returns 404 when listRevisions returns null (cross-patient)', async () => {
    // `null` from the query layer means "parent note doesn't belong to this
    // (tenantId, patientId)" — distinct from `[]` ("note exists, never edited").
    vi.mocked(listRevisions).mockResolvedValueOnce(null)

    const req = new Request(
      'http://localhost/api/patients/p1/evolutions/n1/revisions',
    )

    const res = await GET_REVISIONS(req, {
      params: paramsOf({ id: 'p1', noteId: 'n1' }),
    })

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Nota não encontrada')
  })

  it('returns 200 with revisions array on success', async () => {
    const fakeRevisions = [
      {
        id: 'rev-1',
        evolutionId: 'n1',
        tenantId: 'tenant-1',
        body: 'pre-edit body',
        occurredAt: new Date('2026-05-20T15:00:00Z'),
        editedBy: 'user-1',
        editedByName: 'Practitioner Example',
        createdAt: new Date('2026-05-21T12:00:00Z'),
      },
    ]
    vi.mocked(listRevisions).mockResolvedValueOnce(fakeRevisions as never)

    const req = new Request(
      'http://localhost/api/patients/p1/evolutions/n1/revisions',
    )

    const res = await GET_REVISIONS(req, {
      params: paramsOf({ id: 'p1', noteId: 'n1' }),
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.revisions).toHaveLength(1)
    expect(json.revisions[0].id).toBe('rev-1')
    expect(listRevisions).toHaveBeenCalledWith('tenant-1', 'p1', 'n1')
  })
})
