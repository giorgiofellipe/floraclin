'use client'

import { useSearchParams } from 'next/navigation'
import { usePatients } from '@/hooks/queries/use-patients'
import { PatientList } from '@/components/patients/patient-list'
import PacientesLoading from './loading'

export function PacientesPageClient() {
  const searchParams = useSearchParams()

  const search = searchParams.get('busca') ?? ''
  const page = Math.max(1, Number(searchParams.get('pagina')) || 1)

  const { data, isLoading } = usePatients(search, page)

  if (isLoading || !data) {
    return <PacientesLoading />
  }

  return <PatientList result={data} search={search} />
}
