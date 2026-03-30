import type { Metadata } from 'next'
import { Suspense } from 'react'
import { EvaluationTemplatePageClient } from './evaluation-template-page-client'

export const metadata: Metadata = {
  title: 'Ficha de Avaliacao | FloraClin',
}

interface PageProps {
  params: Promise<{ procedureTypeId: string }>
}

export default async function EvaluationTemplatePage({ params }: PageProps) {
  const { procedureTypeId } = await params

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12 text-mid">
          Carregando...
        </div>
      }
    >
      <EvaluationTemplatePageClient procedureTypeId={procedureTypeId} />
    </Suspense>
  )
}
