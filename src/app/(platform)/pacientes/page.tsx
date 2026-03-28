import type { Metadata } from 'next'
import { Suspense } from 'react'

export const metadata: Metadata = {
  title: 'Pacientes | FloraClin',
}
import { listPatientsAction } from '@/actions/patients'
import { PatientList } from '@/components/patients/patient-list'
import { DEFAULT_PAGE_SIZE } from '@/lib/constants'

interface PacientesPageProps {
  searchParams: Promise<{ busca?: string; pagina?: string }>
}

export default async function PacientesPage({ searchParams }: PacientesPageProps) {
  const params = await searchParams
  const search = params.busca ?? ''
  const page = Math.max(1, Number(params.pagina) || 1)

  const result = await listPatientsAction(search, page, DEFAULT_PAGE_SIZE)

  return (
    <Suspense fallback={<div className="text-muted-foreground">Carregando...</div>}>
      <PatientList result={result} search={search} />
    </Suspense>
  )
}
