'use client'

import { useRouter } from 'next/navigation'
import { useProcedureTypes } from '@/hooks/queries/use-procedure-types'
import { useEvaluationTemplates } from '@/hooks/queries/use-evaluation'
import { TemplateEditorPage } from './template-editor-page'
import type { EvaluationSection } from '@/types/evaluation'

interface EvaluationTemplatePageClientProps {
  procedureTypeId: string
}

export function EvaluationTemplatePageClient({ procedureTypeId }: EvaluationTemplatePageClientProps) {
  const router = useRouter()
  const { data: procedureTypes, isLoading: typesLoading } = useProcedureTypes()
  const { data: templates, isLoading: templatesLoading } = useEvaluationTemplates([procedureTypeId])

  const isLoading = typesLoading || templatesLoading

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-mid">
        Carregando...
      </div>
    )
  }

  const procedureType = (procedureTypes ?? []).find((pt: { id: string }) => pt.id === procedureTypeId)
  if (!procedureType) {
    router.push('/configuracoes')
    return null
  }

  const template = (templates ?? []).find((t: { procedureTypeId: string }) => t.procedureTypeId === procedureTypeId)

  return (
    <TemplateEditorPage
      procedureType={{
        id: procedureType.id,
        name: procedureType.name,
        category: procedureType.category,
      }}
      template={
        template
          ? {
              id: template.id,
              sections: template.sections as EvaluationSection[],
              version: template.version,
            }
          : null
      }
    />
  )
}
