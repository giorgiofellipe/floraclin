import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { syncAppointmentToGoogle } from '@/lib/google-calendar-sync'
import {
  listAppointments,
  createAppointment,
  checkTimeConflict,
} from '@/db/queries/appointments'
import { getProspectByPatientId, getProspectByPhone, updateProspect, logProspectActivity } from '@/db/queries/prospects'
import { getPatient } from '@/db/queries/patients'
import { createAppointmentSchema } from '@/validations/appointment'

const STAGES_MOVABLE_TO_AGENDADO = ['novo', 'contatado', 'qualificado', 'convertido']

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)
    const practitionerId = searchParams.get('practitionerId') ?? undefined
    const dateFrom = searchParams.get('dateFrom') ?? ''
    const dateTo = searchParams.get('dateTo') ?? ''

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'dateFrom and dateTo are required' }, { status: 400 })
    }

    const data = await listAppointments(ctx.tenantId, {
      practitionerId,
      dateFrom,
      dateTo,
    })
    return NextResponse.json(data)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner', 'receptionist'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = createAppointmentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { data } = parsed

    // Conflict check
    const hasConflict = await checkTimeConflict(
      ctx.tenantId,
      data.practitionerId,
      data.date,
      data.startTime,
      data.endTime
    )

    if (hasConflict) {
      return NextResponse.json(
        { error: 'Já existe um agendamento neste horário para este profissional.' },
        { status: 409 }
      )
    }

    const appointment = await createAppointment(ctx.tenantId, {
      patientId: data.patientId,
      practitionerId: data.practitionerId,
      procedureTypeId: data.procedureTypeId,
      date: data.date,
      startTime: data.startTime,
      endTime: data.endTime,
      notes: data.notes,
      source: data.source,
      bookingName: data.bookingName,
      bookingPhone: data.bookingPhone,
      bookingEmail: data.bookingEmail,
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'appointment',
      entityId: appointment.id,
    })

    syncAppointmentToGoogle(ctx.tenantId, appointment.id).catch((err) => {
      console.error('Google Calendar push sync failed:', err)
    })

    // Auto-move CRM lead to "agendado" if the patient has a linked prospect
    if (data.patientId) {
      try {
        let prospect = await getProspectByPatientId(ctx.tenantId, data.patientId)
        if (!prospect) {
          const patient = await getPatient(ctx.tenantId, data.patientId)
          if (patient?.phone) {
            prospect = await getProspectByPhone(ctx.tenantId, patient.phone)
          }
        }
        if (prospect && STAGES_MOVABLE_TO_AGENDADO.includes(prospect.stage)) {
          const previousStage = prospect.stage
          await updateProspect(ctx.tenantId, prospect.id, { stage: 'agendado' })
          await logProspectActivity(ctx.tenantId, prospect.id, 'stage_changed', {
            from: previousStage,
            to: 'agendado',
            trigger: 'appointment_created',
          }, ctx.userId)
        }
      } catch (err) {
        console.error('Failed to auto-advance prospect stage:', err)
      }
    }

    return NextResponse.json({ success: true, data: appointment })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('exclusion')) {
      return NextResponse.json(
        { error: 'Conflito de horário detectado. Escolha outro horário.' },
        { status: 409 }
      )
    }
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
