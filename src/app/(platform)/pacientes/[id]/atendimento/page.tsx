import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getAuthContext } from '@/lib/auth'
import { getPatient } from '@/db/queries/patients'
import { AtendimentoPageClient } from './atendimento-page-client'
import AtendimentoLoading from './loading'

interface AtendimentoPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ step?: string }>
}

export async function generateMetadata({ params }: AtendimentoPageProps): Promise<Metadata> {
  try {
    const { id } = await params
    const ctx = await getAuthContext()
    const patient = await getPatient(ctx.tenantId, id)
    return {
      title: patient
        ? `Atendimento \u00b7 ${patient.fullName} | FloraClin`
        : 'Atendimento | FloraClin',
    }
  } catch {
    return { title: 'Atendimento | FloraClin' }
  }
}

export default async function AtendimentoPage({
  params,
}: AtendimentoPageProps) {
  const { id: patientId } = await params

  return (
    <Suspense fallback={<AtendimentoLoading />}>
      <AtendimentoPageClient patientId={patientId} />
    </Suspense>
  )
}
