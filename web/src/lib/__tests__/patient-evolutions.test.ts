/**
 * Service-layer tests for `web/src/lib/patient-evolutions.ts` (Task C1).
 *
 * These tests run without a real DB. We mock:
 *   - `@/db/queries/patient-evolutions` — every query function is a vi.fn()
 *     spy so we can assert call args, call order, and the shared `tx`
 *     sentinel that proves consecutive calls run inside one transaction.
 *   - `@/lib/audit` — `createAuditLog` is a vi.fn() spy so we can assert
 *     RA-9: edit/create do NOT call it; delete DOES call it.
 *   - `@/lib/tenant` — `withTransaction(fn)` invokes `fn(tx)` with a stable
 *     sentinel object so every query receives the same `tx` instance.
 *
 * Beyond happy-path coverage, the tests assert:
 *   - RA-1: every locked read receives `patientId` (cross-patient enforcement).
 *   - RA-9: revisions are the edit audit — no `createAuditLog` on `editNote`
 *     or `createNote`; `softDeleteNote` DOES audit with `action='delete'` and
 *     `changes` carrying the reason.
 *   - Call ORDER: snapshot-before-update for `editNote`; soft-delete-before-
 *     audit for `softDeleteNote`. We use `vi.fn().mock.invocationCallOrder`
 *     so the assertion is a single inequality, not brittle string matching.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Shared sentinel: proves "one tx" across consecutive query calls ──
//
// `withTransaction(fn)` resolves with the result of `fn(TX_SENTINEL)`. Every
// mocked query function receives this same object as its first arg, so we
// can assert `getNoteLockedForUpdate.mock.calls[0][0] === insertRevisionSnapshot.mock.calls[0][0]`
// and know both ran inside the same tx without standing up a real Postgres.
const TX_SENTINEL = { __isTx: true } as const

// ─── Mocks (hoisted to top of file by vitest) ────────────────────────

vi.mock('@/lib/tenant', () => ({
  withTransaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(TX_SENTINEL)),
}))

vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(async () => {}),
}))

vi.mock('@/db/queries/patient-evolutions', () => ({
  getNoteLockedForUpdate: vi.fn(),
  insertRevisionSnapshot: vi.fn(),
  updateNoteFields: vi.fn(),
  softDeleteNote: vi.fn(),
  insertNote: vi.fn(),
}))

// The service file imports `patientEvolutions` from `@/db/schema` only for a
// type-level `$inferSelect` — we don't need a real table object, but the
// import must resolve. Stub the whole module to a minimal shape.
vi.mock('@/db/schema', () => ({
  patientEvolutions: {},
}))

// ─── Imports under test (after mocks) ─────────────────────────────────

import { createAuditLog } from '@/lib/audit'
import {
  getNoteLockedForUpdate,
  insertNote,
  insertRevisionSnapshot,
  softDeleteNote as softDeleteNoteQuery,
  updateNoteFields,
} from '@/db/queries/patient-evolutions'

import {
  createNote,
  editNote,
  softDeleteNote,
} from '../patient-evolutions'

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Build a fake "current note" row in the shape `getNoteLockedForUpdate`
 * returns. Only the fields the service actually reads are populated; the
 * rest are stubbed with safe defaults.
 */
function makeNote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'note-1',
    tenantId: 'tenant-A',
    patientId: 'patient-1',
    body: 'pre-edit body',
    authorId: 'user-1',
    authorName: 'Test Author',
    occurredAt: new Date('2026-05-20T15:00:00Z'),
    createdAt: new Date('2026-05-20T15:00:00Z'),
    updatedAt: new Date('2026-05-20T15:00:00Z'),
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    revisionCount: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(getNoteLockedForUpdate).mockReset()
  vi.mocked(insertRevisionSnapshot).mockReset()
  vi.mocked(updateNoteFields).mockReset()
  vi.mocked(softDeleteNoteQuery).mockReset()
  vi.mocked(insertNote).mockReset()
  vi.mocked(createAuditLog).mockReset()
  vi.mocked(createAuditLog).mockResolvedValue(undefined)
})

// ─── editNote ─────────────────────────────────────────────────────────

describe('editNote', () => {
  it('throws EVOLUTION_NOTE_NOT_FOUND when getNoteLockedForUpdate returns null', async () => {
    vi.mocked(getNoteLockedForUpdate).mockResolvedValueOnce(null)

    await expect(
      editNote({
        tenantId: 'tenant-A',
        patientId: 'patient-1',
        noteId: 'note-missing',
        editorId: 'user-1',
        body: 'new body',
      }),
    ).rejects.toMatchObject({
      name: 'BusinessError',
      code: 'EVOLUTION_NOTE_NOT_FOUND',
    })

    // No follow-up writes when the lock missed.
    expect(insertRevisionSnapshot).not.toHaveBeenCalled()
    expect(updateNoteFields).not.toHaveBeenCalled()
  })

  it('writes pre-edit revision snapshot, then updates note, in a single tx, in correct order', async () => {
    const current = makeNote({ body: 'pre-edit body' })
    vi.mocked(getNoteLockedForUpdate).mockResolvedValueOnce(current)
    vi.mocked(insertRevisionSnapshot).mockResolvedValueOnce({} as never)
    vi.mocked(updateNoteFields).mockResolvedValueOnce({
      ...current,
      body: 'new body',
    } as never)

    await editNote({
      tenantId: 'tenant-A',
      patientId: 'patient-1',
      noteId: 'note-1',
      editorId: 'editor-1',
      body: 'new body',
    })

    // Order: lock → revision snapshot → update. invocationCallOrder is a
    // monotonically increasing counter shared across all vi.fn()s in the
    // suite, so `<` proves "called before".
    const lockOrder = vi.mocked(getNoteLockedForUpdate).mock.invocationCallOrder[0]
    const snapshotOrder = vi.mocked(insertRevisionSnapshot).mock.invocationCallOrder[0]
    const updateOrder = vi.mocked(updateNoteFields).mock.invocationCallOrder[0]
    expect(lockOrder).toBeLessThan(snapshotOrder)
    expect(snapshotOrder).toBeLessThan(updateOrder)

    // Same tx sentinel passed to every query — proves single-tx execution.
    const lockTx = vi.mocked(getNoteLockedForUpdate).mock.calls[0][0]
    const snapshotTx = vi.mocked(insertRevisionSnapshot).mock.calls[0][0]
    const updateTx = vi.mocked(updateNoteFields).mock.calls[0][0]
    expect(lockTx).toBe(TX_SENTINEL)
    expect(snapshotTx).toBe(TX_SENTINEL)
    expect(updateTx).toBe(TX_SENTINEL)

    // Snapshot carries the PRE-edit body (not the new one).
    expect(vi.mocked(insertRevisionSnapshot).mock.calls[0][1]).toMatchObject({
      tenantId: 'tenant-A',
      evolutionId: 'note-1',
      body: 'pre-edit body',
      editedBy: 'editor-1',
    })
  })

  it('RA-9: does NOT call createAuditLog on edit', async () => {
    const current = makeNote()
    vi.mocked(getNoteLockedForUpdate).mockResolvedValueOnce(current)
    vi.mocked(insertRevisionSnapshot).mockResolvedValueOnce({} as never)
    vi.mocked(updateNoteFields).mockResolvedValueOnce(current as never)

    await editNote({
      tenantId: 'tenant-A',
      patientId: 'patient-1',
      noteId: 'note-1',
      editorId: 'editor-1',
      body: 'new body',
    })

    // The revisions table IS the edit audit per RA-9. Double-logging to
    // audit_logs is a regression we explicitly guard against.
    expect(createAuditLog).not.toHaveBeenCalled()
  })

  it('RA-1: passes patientId through to getNoteLockedForUpdate', async () => {
    const current = makeNote({ patientId: 'patient-42' })
    vi.mocked(getNoteLockedForUpdate).mockResolvedValueOnce(current)
    vi.mocked(insertRevisionSnapshot).mockResolvedValueOnce({} as never)
    vi.mocked(updateNoteFields).mockResolvedValueOnce(current as never)

    await editNote({
      tenantId: 'tenant-A',
      patientId: 'patient-42',
      noteId: 'note-1',
      editorId: 'editor-1',
      body: 'new body',
    })

    // Signature: (tx, tenantId, patientId, noteId). The patient arg is the
    // RA-1 enforcement — without it, a cross-patient ID could open a note.
    const call = vi.mocked(getNoteLockedForUpdate).mock.calls[0]
    expect(call[1]).toBe('tenant-A')
    expect(call[2]).toBe('patient-42')
    expect(call[3]).toBe('note-1')
  })
})

// ─── softDeleteNote ───────────────────────────────────────────────────

describe('softDeleteNote', () => {
  it('throws EVOLUTION_NOTE_NOT_FOUND when getNoteLockedForUpdate returns null', async () => {
    vi.mocked(getNoteLockedForUpdate).mockResolvedValueOnce(null)

    await expect(
      softDeleteNote({
        tenantId: 'tenant-A',
        patientId: 'patient-1',
        noteId: 'note-missing',
        deletedBy: 'user-1',
        deleteReason: 'duplicado',
      }),
    ).rejects.toMatchObject({
      name: 'BusinessError',
      code: 'EVOLUTION_NOTE_NOT_FOUND',
    })

    expect(softDeleteNoteQuery).not.toHaveBeenCalled()
    expect(createAuditLog).not.toHaveBeenCalled()
  })

  it('calls softDeleteNote query then createAuditLog inside one tx', async () => {
    const current = makeNote()
    vi.mocked(getNoteLockedForUpdate).mockResolvedValueOnce(current)
    vi.mocked(softDeleteNoteQuery).mockResolvedValueOnce({} as never)

    await softDeleteNote({
      tenantId: 'tenant-A',
      patientId: 'patient-1',
      noteId: 'note-1',
      deletedBy: 'user-1',
      deleteReason: 'duplicado',
    })

    const lockOrder = vi.mocked(getNoteLockedForUpdate).mock.invocationCallOrder[0]
    const deleteOrder = vi.mocked(softDeleteNoteQuery).mock.invocationCallOrder[0]
    const auditOrder = vi.mocked(createAuditLog).mock.invocationCallOrder[0]
    expect(lockOrder).toBeLessThan(deleteOrder)
    expect(deleteOrder).toBeLessThan(auditOrder)

    // Same tx passed to every step — single-tx invariant.
    const lockTx = vi.mocked(getNoteLockedForUpdate).mock.calls[0][0]
    const deleteTx = vi.mocked(softDeleteNoteQuery).mock.calls[0][0]
    // createAuditLog signature: (params, tx?) — tx is the second arg.
    const auditTx = vi.mocked(createAuditLog).mock.calls[0][1]
    expect(lockTx).toBe(TX_SENTINEL)
    expect(deleteTx).toBe(TX_SENTINEL)
    expect(auditTx).toBe(TX_SENTINEL)
  })

  it("RA-9: createAuditLog is called with action='delete', changes containing the reason", async () => {
    const current = makeNote()
    vi.mocked(getNoteLockedForUpdate).mockResolvedValueOnce(current)
    vi.mocked(softDeleteNoteQuery).mockResolvedValueOnce({} as never)

    await softDeleteNote({
      tenantId: 'tenant-A',
      patientId: 'patient-1',
      noteId: 'note-1',
      deletedBy: 'user-1',
      deleteReason: 'wrong patient',
    })

    expect(createAuditLog).toHaveBeenCalledTimes(1)
    const [auditParams] = vi.mocked(createAuditLog).mock.calls[0]
    expect(auditParams).toMatchObject({
      tenantId: 'tenant-A',
      userId: 'user-1',
      action: 'delete',
      entityType: 'patient_evolution',
      entityId: 'note-1',
      changes: { reason: { old: null, new: 'wrong patient' } },
    })
  })

  it('RA-1: passes patientId through to getNoteLockedForUpdate', async () => {
    const current = makeNote({ patientId: 'patient-99' })
    vi.mocked(getNoteLockedForUpdate).mockResolvedValueOnce(current)
    vi.mocked(softDeleteNoteQuery).mockResolvedValueOnce({} as never)

    await softDeleteNote({
      tenantId: 'tenant-A',
      patientId: 'patient-99',
      noteId: 'note-1',
      deletedBy: 'user-1',
      deleteReason: null,
    })

    const call = vi.mocked(getNoteLockedForUpdate).mock.calls[0]
    expect(call[1]).toBe('tenant-A')
    expect(call[2]).toBe('patient-99')
    expect(call[3]).toBe('note-1')
  })
})

// ─── createNote ───────────────────────────────────────────────────────

describe('createNote', () => {
  it('calls insertNote with the right tenantId/patientId/authorId', async () => {
    vi.mocked(insertNote).mockResolvedValueOnce({
      id: 'note-new',
      tenantId: 'tenant-A',
      patientId: 'patient-1',
      body: 'fresh content',
      authorId: 'author-1',
    } as never)

    await createNote({
      tenantId: 'tenant-A',
      patientId: 'patient-1',
      authorId: 'author-1',
      body: 'fresh content',
      occurredAt: null,
    })

    expect(insertNote).toHaveBeenCalledTimes(1)
    const [tx, args] = vi.mocked(insertNote).mock.calls[0]
    expect(tx).toBe(TX_SENTINEL)
    expect(args).toMatchObject({
      tenantId: 'tenant-A',
      patientId: 'patient-1',
      authorId: 'author-1',
      body: 'fresh content',
      occurredAt: null,
    })
  })

  it('RA-9: does NOT call createAuditLog on create', async () => {
    vi.mocked(insertNote).mockResolvedValueOnce({
      id: 'note-new',
      tenantId: 'tenant-A',
      patientId: 'patient-1',
      body: 'x',
      authorId: 'author-1',
    } as never)

    await createNote({
      tenantId: 'tenant-A',
      patientId: 'patient-1',
      authorId: 'author-1',
      body: 'x',
      occurredAt: null,
    })

    // Per RA-9, creation is not audit-logged — the note's own row carries
    // authorId + createdAt and IS the audit. Double-logging would create
    // noise and erode trust in audit_logs as a delete-trail.
    expect(createAuditLog).not.toHaveBeenCalled()
  })
})
