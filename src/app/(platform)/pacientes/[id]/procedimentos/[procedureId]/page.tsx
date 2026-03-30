import { Suspense } from 'react'
import { ProcedurePageClient } from './procedure-page-client'

interface ProcedurePageProps {
  params: Promise<{
    id: string
    procedureId: string
  }>
  searchParams: Promise<{
    action?: string
  }>
}

export default async function ProcedurePage({ params, searchParams }: ProcedurePageProps) {
  const { id: patientId, procedureId } = await params
  const { action } = await searchParams

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12 text-mid">
          Carregando...
        </div>
      }
    >
      <ProcedurePageClient
        patientId={patientId}
        procedureId={procedureId}
        action={action}
      />
    </Suspense>
  )
}
