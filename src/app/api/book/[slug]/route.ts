import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { tenants, tenantUsers, users, appointments } from '@/db/schema'
import { eq, and, isNull, or, gte } from 'drizzle-orm'
import { z } from 'zod'
import { checkTimeConflict, createAppointment } from '@/db/queries/appointments'

interface WorkingHoursDay {
  start: string
  end: string
  enabled: boolean
}

type WorkingHours = Record<string, WorkingHoursDay>

interface TenantSettings {
  online_booking_enabled?: boolean
  [key: string]: unknown
}

async function getTenantBySlug(slug: string) {
  const result = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      logoUrl: tenants.logoUrl,
      phone: tenants.phone,
      email: tenants.email,
      workingHours: tenants.workingHours,
      settings: tenants.settings,
    })
    .from(tenants)
    .where(and(eq(tenants.slug, slug), isNull(tenants.deletedAt)))
    .limit(1)

  return result[0] ?? null
}

async function getPractitioners(tenantId: string) {
  const result = await db
    .select({
      id: users.id,
      fullName: users.fullName,
    })
    .from(users)
    .innerJoin(
      tenantUsers,
      and(
        eq(tenantUsers.userId, users.id),
        eq(tenantUsers.tenantId, tenantId),
        eq(tenantUsers.isActive, true),
        or(eq(tenantUsers.role, 'practitioner'), eq(tenantUsers.role, 'owner'))
      )
    )
    .where(isNull(users.deletedAt))
    .orderBy(users.fullName)

  return result
}

// GET /api/book/[slug] - Returns clinic info and practitioners
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const tenant = await getTenantBySlug(slug)

    if (!tenant) {
      return NextResponse.json(
        { error: 'Clínica não encontrada' },
        { status: 404 }
      )
    }

    const settings = (tenant.settings as TenantSettings) ?? {}
    if (settings.online_booking_enabled === false) {
      return NextResponse.json(
        { error: 'Agendamento online não está habilitado para esta clínica' },
        { status: 404 }
      )
    }

    const practitioners = await getPractitioners(tenant.id)

    return NextResponse.json({
      clinic: {
        name: tenant.name,
        logoUrl: tenant.logoUrl,
        phone: tenant.phone,
        email: tenant.email,
      },
      practitioners: practitioners.map((p) => ({
        id: p.id,
        name: p.fullName,
      })),
    })
  } catch (error) {
    console.error('Error fetching clinic info:', error)
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    )
  }
}

const bookingSchema = z.object({
  name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  phone: z
    .string()
    .min(10, 'Telefone inválido')
    .max(20, 'Telefone inválido'),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
  practitionerId: z.string().uuid('Profissional inválido'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Horário inválido'),
})

// POST /api/book/[slug] - Create a booking
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const tenant = await getTenantBySlug(slug)

    if (!tenant) {
      return NextResponse.json(
        { error: 'Clínica não encontrada' },
        { status: 404 }
      )
    }

    const settings = (tenant.settings as TenantSettings) ?? {}
    if (settings.online_booking_enabled === false) {
      return NextResponse.json(
        { error: 'Agendamento online não está habilitado para esta clínica' },
        { status: 404 }
      )
    }

    const body = await request.json()
    const parsed = bookingSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { name, phone, email, practitionerId, date, startTime } = parsed.data

    // Rate limiting: check for duplicate booking from same phone in last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    const duplicates = await db
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, tenant.id),
          eq(appointments.bookingPhone, phone),
          eq(appointments.source, 'online_booking'),
          isNull(appointments.deletedAt),
          gte(appointments.createdAt, fiveMinutesAgo)
        )
      )
      .limit(1)

    if (duplicates.length > 0) {
      return NextResponse.json(
        {
          error:
            'Você já realizou um agendamento recentemente. Aguarde alguns minutos antes de tentar novamente.',
        },
        { status: 429 }
      )
    }

    // Calculate end time (30 min slots by default)
    const [h, m] = startTime.split(':').map(Number)
    const endMinutes = h * 60 + m + 30
    const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`

    // Check for time conflict
    const hasConflict = await checkTimeConflict(
      tenant.id,
      practitionerId,
      date,
      startTime,
      endTime
    )

    if (hasConflict) {
      return NextResponse.json(
        { error: 'Este horário já não está mais disponível. Por favor, escolha outro.' },
        { status: 409 }
      )
    }

    // Validate practitioner belongs to this tenant
    const practitioner = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(
        tenantUsers,
        and(
          eq(tenantUsers.userId, users.id),
          eq(tenantUsers.tenantId, tenant.id),
          eq(tenantUsers.isActive, true)
        )
      )
      .where(and(eq(users.id, practitionerId), isNull(users.deletedAt)))
      .limit(1)

    if (practitioner.length === 0) {
      return NextResponse.json(
        { error: 'Profissional não encontrado' },
        { status: 400 }
      )
    }

    // Create appointment
    const appointment = await createAppointment(tenant.id, {
      practitionerId,
      date,
      startTime,
      endTime,
      status: 'scheduled',
      source: 'online_booking',
      patientId: null,
      bookingName: name,
      bookingPhone: phone,
      bookingEmail: email || undefined,
    })

    return NextResponse.json(
      {
        success: true,
        appointment: {
          id: appointment.id,
          date: appointment.date,
          startTime: appointment.startTime,
          endTime: appointment.endTime,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error creating booking:', error)
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    )
  }
}
