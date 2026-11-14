'use client'

import { useSearchParams } from 'next/navigation'
import { usePatients } from '@/hooks/queries/use-patients'
import { Button } from '@/components/ui/button'
import { PatientList } from '@/components/patients/patient-list'
import { patientSortSchema, sortDirectionSchema } from '@/validations/patient'
import PatientsLoading from './loading'

export function PacientesPageClient({ whatsappInApp }: { whatsappInApp: boolean }) {
  const searchParams = useSearchParams()

  const search = searchParams.get('busca') ?? ''
  const page = Math.max(1, Number(searchParams.get('pagina')) || 1)
  const sort = patientSortSchema.catch('nome').parse(searchParams.get('ordem'))
  const direction = sortDirectionSchema.catch('asc').parse(searchParams.get('direcao'))

  const { data, isFetching, isError, refetch } = usePatients({ search, page, sort, direction })

  if (!data && isError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[3px] border border-destructive/20 bg-destructive/5 px-6 py-12 text-center">
        <p className="text-[13px] font-medium text-destructive">Não foi possível carregar os pacientes.</p>
        <Button type="button" variant="outline" onClick={() => refetch()} className="mt-3 h-11 md:h-8">
          Tentar novamente
        </Button>
      </div>
    )
  }

  if (!data) return <PatientsLoading />

  return (
    <PatientList
      result={data}
      search={search}
      sort={sort}
      direction={direction}
      isFetching={isFetching}
      whatsappInApp={whatsappInApp}
    />
  )
}
