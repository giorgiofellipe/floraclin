import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getPatientAction } from '@/actions/patients'
import { AtendimentoPageClient } from './atendimento-page-client'
import AtendimentoLoading from './loading'

interface AtendimentoPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ step?: string }>
}

export async function generateMetadata({ params }: AtendimentoPageProps): Promise<Metadata> {
  const { id } = await params
  const patient = await getPatientAction(id)
  return {
    title: patient
      ? `Atendimento \u00b7 ${patient.fullName} | FloraClin`
      : 'Atendimento | FloraClin',
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
