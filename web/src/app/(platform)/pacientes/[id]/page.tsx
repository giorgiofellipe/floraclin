import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getAuthContext } from '@/lib/auth'
import { getPatient } from '@/db/queries/patients'
import { PatientDetailPageClient } from './patient-detail-page-client'

interface PatientDetailPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}

export async function generateMetadata({ params }: PatientDetailPageProps): Promise<Metadata> {
  try {
    const { id } = await params
    const ctx = await getAuthContext()
    const patient = await getPatient(ctx.tenantId, id)
    return {
      title: patient ? `${patient.fullName} | FloraClin` : 'Paciente | FloraClin',
    }
  } catch {
    return { title: 'Paciente | FloraClin' }
  }
}

export default async function PatientDetailPage({
  params,
}: PatientDetailPageProps) {
  const { id } = await params

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12 text-mid">
          Carregando...
        </div>
      }
    >
      <PatientDetailPageClient patientId={id} />
    </Suspense>
  )
}
