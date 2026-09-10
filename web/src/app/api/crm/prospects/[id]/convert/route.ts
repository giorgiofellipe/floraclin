import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { getTenant } from '@/db/queries/tenants'
import { getProspect, convertProspect, logProspectActivity } from '@/db/queries/prospects'
import { createPatient, getPatient } from '@/db/queries/patients'
import { pushSseEvent } from '@/db/queries/whatsapp'
import { convertProspectSchema } from '@/validations/prospect'
import type { Role } from '@/types'
import { handleApiError } from '@/lib/api-error'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()

    // Check WhatsApp is enabled and user's role is allowed
    const tenant = await getTenant(ctx.tenantId)
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>
    if (!settings.whatsapp_enabled) {
      return NextResponse.json({ error: 'WhatsApp não está habilitado' }, { status: 403 })
    }
    const allowedRoles = (settings.whatsapp_allowed_roles as string[] | undefined) ?? ['owner']
    if (!allowedRoles.includes(ctx.role as Role) && ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Sem permissão para acessar o CRM' }, { status: 403 })
    }

    // Role is already gated dynamically above (whatsapp_allowed_roles ?? ['owner']);
    // requireWrite here only adds the subscription check, so it is passed every
    // role to avoid re-narrowing what the dynamic check already allowed.
    const { blocked } = await requireWrite('owner', 'practitioner', 'receptionist', 'financial')
    if (blocked) return blocked

    const { id } = await params

    // Verify prospect exists
    const existing = await getProspect(ctx.tenantId, id)
    if (!existing) {
      return NextResponse.json({ error: 'Lead não encontrado' }, { status: 404 })
    }

    if (existing.stage === 'convertido') {
      return NextResponse.json({ error: 'Lead já foi convertido' }, { status: 400 })
    }

    const body = await request.json()
    const parsed = convertProspectSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    let patientId: string

    if (parsed.data.patientId) {
      const existingPatient = await getPatient(ctx.tenantId, parsed.data.patientId)
      if (!existingPatient) {
        return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
      }
      patientId = parsed.data.patientId
    } else if (parsed.data.createPatient) {
      // Create a new patient, then link
      const patient = await createPatient(ctx.tenantId, {
        fullName: parsed.data.createPatient.fullName,
        phone: parsed.data.createPatient.phone,
      }, ctx.userId)
      patientId = patient.id
    } else {
      return NextResponse.json(
        { error: 'Selecione um paciente ou crie um novo' },
        { status: 400 },
      )
    }

    // Convert prospect: sets stage to 'convertido' and updates conversation FK
    const prospect = await convertProspect(ctx.tenantId, id, patientId)
    if (!prospect) {
      return NextResponse.json({ error: 'Erro ao converter lead' }, { status: 500 })
    }

    await logProspectActivity(ctx.tenantId, id, 'converted', { patientId }, ctx.userId)

    await pushSseEvent(ctx.tenantId, 'prospect_updated', {
      prospectId: id,
      patientId,
      stage: 'convertido',
    })

    return NextResponse.json({ data: prospect })
  } catch (error) {
    return handleApiError(error, request)
  }
}
