import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import {
  getPatient,
  updatePatient,
  deletePatient,
} from '@/db/queries/patients'
import { updatePatientSchema } from '@/validations/patient'
import { handleApiError } from '@/lib/api-error'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    const { id } = await params
    const patient = await getPatient(ctx.tenantId, id)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }
    return NextResponse.json(patient)
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner', 'receptionist')
    if (blocked) return blocked

    const { id } = await params
    const body = await request.json()
    const parsed = updatePatientSchema.safeParse({ ...body, id })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { id: patientId, ...updateData } = parsed.data
    const existing = await getPatient(ctx.tenantId, patientId)
    if (!existing) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    const patient = await updatePatient(ctx.tenantId, patientId, updateData)
    if (!patient) {
      return NextResponse.json({ error: 'Erro ao atualizar paciente' }, { status: 500 })
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'patient',
      entityId: patientId,
      changes: { patient: { old: existing, new: updateData } },
    })

    return NextResponse.json({ success: true, data: patient })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner', 'receptionist')
    if (blocked) return blocked

    const { id } = await params
    const patient = await deletePatient(ctx.tenantId, id)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'delete',
      entityType: 'patient',
      entityId: id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
