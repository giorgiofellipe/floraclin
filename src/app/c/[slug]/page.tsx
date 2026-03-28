import { notFound } from 'next/navigation'
import { BookingPage } from '@/components/booking/booking-page'
import type { Metadata } from 'next'

interface ClinicApiResponse {
  clinic: {
    name: string
    logoUrl: string | null
    phone: string | null
    email: string | null
  }
  practitioners: { id: string; name: string }[]
}

async function getClinicData(slug: string): Promise<ClinicApiResponse | null> {
  // Use internal import to avoid HTTP call during SSR
  const { db } = await import('@/db/client')
  const { tenants, tenantUsers, users } = await import('@/db/schema')
  const { eq, and, isNull, or } = await import('drizzle-orm')

  const tenant = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      logoUrl: tenants.logoUrl,
      phone: tenants.phone,
      email: tenants.email,
      settings: tenants.settings,
    })
    .from(tenants)
    .where(and(eq(tenants.slug, slug), isNull(tenants.deletedAt)))
    .limit(1)

  if (tenant.length === 0) return null

  const t = tenant[0]
  const settings = (t.settings as Record<string, unknown>) ?? {}
  if (settings.online_booking_enabled === false) return null

  const practitioners = await db
    .select({
      id: users.id,
      fullName: users.fullName,
    })
    .from(users)
    .innerJoin(
      tenantUsers,
      and(
        eq(tenantUsers.userId, users.id),
        eq(tenantUsers.tenantId, t.id),
        eq(tenantUsers.isActive, true),
        or(eq(tenantUsers.role, 'practitioner'), eq(tenantUsers.role, 'owner'))
      )
    )
    .where(isNull(users.deletedAt))
    .orderBy(users.fullName)

  return {
    clinic: {
      name: t.name,
      logoUrl: t.logoUrl,
      phone: t.phone,
      email: t.email,
    },
    practitioners: practitioners.map((p) => ({
      id: p.id,
      name: p.fullName,
    })),
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const data = await getClinicData(slug)

  if (!data) {
    return { title: 'Clínica não encontrada | FloraClin' }
  }

  return {
    title: `Agendar consulta | ${data.clinic.name}`,
    description: `Agende sua consulta online com ${data.clinic.name}. Escolha o profissional, data e horário que melhor se encaixam na sua rotina.`,
  }
}

export default async function PublicBookingPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const data = await getClinicData(slug)

  if (!data) {
    notFound()
  }

  return (
    <BookingPage
      clinic={data.clinic}
      practitioners={data.practitioners}
      slug={slug}
    />
  )
}
