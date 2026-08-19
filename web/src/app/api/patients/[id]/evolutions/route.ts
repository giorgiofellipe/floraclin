import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { BusinessError } from '@/lib/errors'
import { getPatientEvolutionFeed } from '@/db/queries/patient-evolutions'
import { getPatient } from '@/db/queries/patients'
import { createNote } from '@/lib/patient-evolutions'
import { createEvolutionSchema } from '@/validations/patient-evolution'
import { handleApiError } from '@/lib/api-error'

// GET /api/patients/[id]/evolutions — feed of clinical notes + executed sessions.
// Response shape per RA-7: `{ entries }` directly (no `{ success, data }` envelope).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { tenantId } = await requireRole('owner', 'practitioner')
    const { id: patientId } = await params

    // Defense-in-depth: confirm the patient belongs to the caller's tenant
    // before doing any work. The feed query is already tenant+patient
    // scoped, but returning 404 here is cleaner than an empty 200 for a
    // cross-tenant/unknown id.
    const patient = await getPatient(tenantId, patientId)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    const entries = await getPatientEvolutionFeed(tenantId, patientId)

    return NextResponse.json({ entries })
  } catch (error) {

    if (error instanceof BusinessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    return handleApiError(error, request, { body: { error: 'Erro interno' } })
  }
}

// POST /api/patients/[id]/evolutions — create a free-text loose note.
// Validation failures map to 400 per RA-6; success returns `{ note }` per RA-7.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { tenantId, userId } = await requireRole('owner', 'practitioner')
    const { id: patientId } = await params

    // Verify the patient belongs to the caller's tenant BEFORE inserting.
    // The insert otherwise blindly accepts any UUID — unlike PATCH/DELETE
    // which are guarded by the tenant-scoped lock, POST has no second line
    // of defense at the service layer.
    const patient = await getPatient(tenantId, patientId)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    // RA-6: malformed JSON must surface as 400, not 500.
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }
    const parsed = createEvolutionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const note = await createNote({
      tenantId,
      patientId,
      authorId: userId,
      body: parsed.data.body,
      occurredAt: parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : null,
    })

    return NextResponse.json({ note }, { status: 201 })
  } catch (error) {

    if (error instanceof BusinessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    return handleApiError(error, request, { body: { error: 'Erro interno' } })
  }
}
