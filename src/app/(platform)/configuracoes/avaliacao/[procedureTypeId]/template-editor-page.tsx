'use client'

import { useRouter } from 'next/navigation'
import { TemplateEditor } from '@/components/evaluation/template-editor'
import {
  updateTemplateAction,
  createTemplateAction,
  resetTemplateToDefaultAction,
} from '@/actions/evaluation-templates'
import type { EvaluationSection, ProcedureCategory } from '@/types/evaluation'

interface TemplateEditorPageProps {
  procedureType: {
    id: string
    name: string
    category: string
  }
  template: {
    id: string
    sections: EvaluationSection[]
    version: number
  } | null
}

export function TemplateEditorPage({ procedureType, template }: TemplateEditorPageProps) {
  const router = useRouter()

  async function handleSave(sections: EvaluationSection[]) {
    if (template) {
      return await updateTemplateAction({
        templateId: template.id,
        sections,
      })
    } else {
      return await createTemplateAction({
        procedureTypeId: procedureType.id,
        name: `Ficha de Avaliacao - ${procedureType.name}`,
        sections,
      })
    }
  }

  async function handleResetToDefault() {
    if (template) {
      return await resetTemplateToDefaultAction({
        templateId: template.id,
        procedureCategory: procedureType.category as ProcedureCategory,
      })
    } else {
      // No template exists yet — create from default
      return await resetTemplateToDefaultAction({
        procedureTypeId: procedureType.id,
        procedureCategory: procedureType.category as ProcedureCategory,
        createIfMissing: true,
        procedureTypeName: procedureType.name,
      })
    }
  }

  function handleBack() {
    router.push('/configuracoes')
  }

  return (
    <TemplateEditor
      procedureTypeName={procedureType.name}
      procedureTypeCategory={procedureType.category}
      templateId={template?.id ?? null}
      initialSections={template?.sections ?? []}
      onSave={handleSave}
      onResetToDefault={handleResetToDefault}
      onBack={handleBack}
    />
  )
}
