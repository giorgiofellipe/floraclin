import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { subscriptionGate } from '@/lib/plans'
import {
  listPatients,
  createPatient,
} from '@/db/queries/patients'
import { createPatientSchema, patientSearchSchema } from '@/validations/patient'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') ?? ''
    const page = Number(searchParams.get('page') ?? '1')
    const limit = Number(searchParams.get('limit') ?? '20')

    const parsed = patientSearchSchema.safeParse({ search, page, limit })
    if (!parsed.success) {
      return NextResponse.json({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 })
    }

    // Practitioners only see their own patients
    const responsibleUserId = ctx.role === 'practitioner' ? ctx.userId : undefined

    const data = await listPatients(ctx.tenantId, { ...parsed.data, responsibleUserId })
    return NextResponse.json(data)
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner', 'receptionist'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const gate = await subscriptionGate(ctx)
    if (gate) return gate

    const body = await request.json()
    const parsed = createPatientSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const patient = await createPatient(ctx.tenantId, parsed.data, ctx.userId)

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'patient',
      entityId: patient.id,
      changes: { patient: { old: null, new: parsed.data } },
    })

    return NextResponse.json({ success: true, data: patient })
  } catch (error) {
    return handleApiError(error, request)
  }
}
