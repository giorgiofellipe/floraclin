import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { listRevisions } from '@/db/queries/patient-evolutions'
import { getPatient } from '@/db/queries/patients'

/**
 * GET /api/patients/[id]/evolutions/[noteId]/revisions
 *
 * Returns the edit history for a single loose note as `{ revisions: [...] }`.
 * Per RA-1, both the patient id (from the route) and the note id are threaded
 * into the query; if the note doesn't belong to the route's patient (cross-
 * patient guess, including same-tenant), we return 404 — not 403/500.
 *
 * Per RA-7, the response is the resource directly — no `{ success, data }`
 * envelope.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  try {
    const { tenantId } = await requireRole('owner', 'practitioner')
    const { id: patientId, noteId } = await params

    // Verify the patient belongs to the caller's tenant up-front.
    const patient = await getPatient(tenantId, patientId)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    const revisions = await listRevisions(tenantId, patientId, noteId)
    if (revisions === null) {
      return NextResponse.json({ error: 'Nota não encontrada' }, { status: 404 })
    }

    return NextResponse.json({ revisions })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (msg === 'Forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Evolution revisions GET error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
