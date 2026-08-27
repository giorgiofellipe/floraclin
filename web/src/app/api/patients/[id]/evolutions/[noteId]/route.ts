import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { BusinessError } from '@/lib/errors'
import { getPatient } from '@/db/queries/patients'
import { editNote, softDeleteNote } from '@/lib/patient-evolutions'
import {
  deleteEvolutionSchema,
  editEvolutionSchema,
} from '@/validations/patient-evolution'
import { handleApiError } from '@/lib/api-error'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked
    const { tenantId, userId } = ctx
    // RA-1: both patientId and noteId are threaded into the service layer so
    // cross-patient ID guesses get caught by the scoped FOR UPDATE lock and
    // return 404 (not 403/500).
    const { id: patientId, noteId } = await params

    // Verify the patient belongs to the caller's tenant up-front. The
    // scoped lock below would already refuse a cross-tenant guess, but
    // returning 404 here keeps the failure shape consistent with the rest
    // of the patient sub-routes.
    const patient = await getPatient(tenantId, patientId)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    // RA-6: malformed JSON must surface as 400, not 500.
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }

    const parsed = editEvolutionSchema.safeParse(body)
    // RA-6: validation failures map to 400, not 500.
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const note = await editNote({
      tenantId,
      patientId,
      noteId,
      editorId: userId,
      body: parsed.data.body,
      occurredAt: parsed.data.occurredAt
        ? new Date(parsed.data.occurredAt)
        : undefined,
    })

    // RA-7: no envelope — return the resource directly.
    return NextResponse.json({ note })
  } catch (error) {
    if (error instanceof BusinessError) {
      // RA-1: cross-patient or missing notes surface as 404.
      if (error.code === 'EVOLUTION_NOTE_NOT_FOUND') {
        return NextResponse.json(
          { error: 'Nota não encontrada' },
          { status: 404 },
        )
      }
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 },
      )
    }
    return handleApiError(error, req)
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked
    const { tenantId, userId } = ctx
    // RA-1: both IDs threaded to the service layer.
    const { id: patientId, noteId } = await params

    // Verify the patient belongs to the caller's tenant up-front.
    const patient = await getPatient(tenantId, patientId)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    // RA-6: malformed JSON must surface as 400, not 500.
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }

    const parsed = deleteEvolutionSchema.safeParse(body)
    // RA-6: validation failures map to 400, not 500.
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.flatten() },
        { status: 400 },
      )
    }

    await softDeleteNote({
      tenantId,
      patientId,
      noteId,
      deletedBy: userId,
      deleteReason: parsed.data.reason,
    })

    // RA-7: DELETE returns 204 No Content, no body.
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof BusinessError) {
      // RA-1: cross-patient or missing notes surface as 404.
      if (error.code === 'EVOLUTION_NOTE_NOT_FOUND') {
        return NextResponse.json(
          { error: 'Nota não encontrada' },
          { status: 404 },
        )
      }
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 },
      )
    }
    return handleApiError(error, req)
  }
}
