import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { currentBrYear } from '@/lib/birthdays'
import {
  clearGreeting,
  getPatientForTenant,
  recordGreeting,
} from '@/db/queries/birthdays'

function parseYear(value: unknown): number | null {
  if (value === undefined || value === null) return null
  const n = typeof value === 'number' ? value : parseInt(String(value), 10)
  if (!Number.isInteger(n) || n < 1900 || n > 2200) return null
  return n
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner', 'receptionist'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { patientId } = await params
    const body = await request.json().catch(() => ({}))
    const requestedYear = parseYear((body as { year?: unknown })?.year)
    const year = requestedYear ?? currentBrYear()

    const patient = await getPatientForTenant({ tenantId: ctx.tenantId, patientId })
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    await recordGreeting({
      tenantId: ctx.tenantId,
      patientId,
      occasionYear: year,
      greetedBy: ctx.userId,
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'patient_greeting',
      entityId: patientId,
      changes: { greeting: { old: null, new: { occasionYear: year } } },
    })

    return NextResponse.json({ success: true, data: { patientId, year } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner', 'receptionist'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { patientId } = await params
    const { searchParams } = new URL(request.url)
    const requestedYear = parseYear(searchParams.get('year'))
    const year = requestedYear ?? currentBrYear()

    const patient = await getPatientForTenant({ tenantId: ctx.tenantId, patientId })
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    await clearGreeting({ tenantId: ctx.tenantId, patientId, occasionYear: year })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'delete',
      entityType: 'patient_greeting',
      entityId: patientId,
      changes: { greeting: { old: { occasionYear: year }, new: null } },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
