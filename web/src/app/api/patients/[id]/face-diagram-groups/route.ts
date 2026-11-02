import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import { verifyTenantOwnership } from '@/db/queries/helpers'
import { patients } from '@/db/schema'
import {
  createStandaloneGroup,
  listPatientDiagramGroups,
} from '@/db/queries/face-diagram-groups'
import { createDiagramGroupSchema } from '@/validations/face-diagram-group'
import { handleApiError } from '@/lib/api-error'

async function patientExists(tenantId: string, patientId: string) {
  try {
    await verifyTenantOwnership(tenantId, patients, patientId, 'Patient')
    return true
  } catch {
    return false
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    const { id } = await params
    if (!(await patientExists(ctx.tenantId, id))) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }
    const data = await listPatientDiagramGroups(ctx.tenantId, id)
    return NextResponse.json({ data })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked

    const { id } = await params
    const parsed = createDiagramGroupSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }
    if (!(await patientExists(ctx.tenantId, id))) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    const groupId = await withTransaction((tx) =>
      createStandaloneGroup(tx, {
        tenantId: ctx.tenantId,
        patientId: id,
        practitionerId: ctx.userId,
        views: parsed.data.views,
        quotationLines: parsed.data.quotationLines,
      })
    )

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'face_diagram_group',
      entityId: groupId,
    })

    return NextResponse.json({ data: { id: groupId } }, { status: 201 })
  } catch (error) {
    return handleApiError(error, request)
  }
}
