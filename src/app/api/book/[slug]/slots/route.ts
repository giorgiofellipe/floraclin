import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { getAvailableSlots } from '@/db/queries/appointments'

interface TenantSettings {
  online_booking_enabled?: boolean
  [key: string]: unknown
}

// GET /api/book/[slug]/slots?practitioner_id=X&date=YYYY-MM-DD
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const { searchParams } = new URL(request.url)
    const practitionerId = searchParams.get('practitioner_id')
    const date = searchParams.get('date')

    if (!practitionerId || !date) {
      return NextResponse.json(
        { error: 'practitioner_id e date são obrigatórios' },
        { status: 400 }
      )
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: 'Formato de data inválido. Use YYYY-MM-DD' },
        { status: 400 }
      )
    }

    // Don't allow booking past dates
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const requestedDate = new Date(date + 'T12:00:00')
    if (requestedDate < today) {
      return NextResponse.json({ slots: [] })
    }

    // Find tenant by slug
    const tenant = await db
      .select({
        id: tenants.id,
        settings: tenants.settings,
      })
      .from(tenants)
      .where(and(eq(tenants.slug, slug), isNull(tenants.deletedAt)))
      .limit(1)

    if (tenant.length === 0) {
      return NextResponse.json(
        { error: 'Clínica não encontrada' },
        { status: 404 }
      )
    }

    const settings = (tenant[0].settings as TenantSettings) ?? {}
    if (settings.online_booking_enabled === false) {
      return NextResponse.json(
        { error: 'Agendamento online não está habilitado' },
        { status: 404 }
      )
    }

    const slots = await getAvailableSlots(
      tenant[0].id,
      practitionerId,
      date,
      30 // 30 minute slots for online booking
    )

    // Format slots for the frontend
    return NextResponse.json({
      slots: slots.map((s) => ({
        startTime: s.start,
        endTime: s.end,
      })),
    })
  } catch (error) {
    console.error('Error fetching slots:', error)
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    )
  }
}
