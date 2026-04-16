'use client'

import { useRouter } from 'next/navigation'
import { TemplateEditor } from '@/components/evaluation/template-editor'
import { useSaveEvaluationTemplate } from '@/hooks/mutations/use-evaluation-mutations'
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
  const saveTemplate = useSaveEvaluationTemplate()

  async function handleSave(sections: EvaluationSection[]) {
    if (template) {
      return await saveTemplate.mutateAsync({
        action: 'update',
        templateId: template.id,
        sections,
      })
    } else {
      return await saveTemplate.mutateAsync({
        action: 'create',
        procedureTypeId: procedureType.id,
        name: `Ficha de Avaliacao - ${procedureType.name}`,
        sections,
      })
    }
  }

  async function handleResetToDefault() {
    if (template) {
      return await saveTemplate.mutateAsync({
        action: 'reset',
        templateId: template.id,
        procedureCategory: procedureType.category as ProcedureCategory,
      })
    } else {
      return await saveTemplate.mutateAsync({
        action: 'reset',
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

  // Escape the platform layout's p-6 entirely so the template editor's own
  // sticky header sits at viewport top:0 and visually replaces the platform
  // header (same approach as the atendimento wizard page).
  return (
    <div className="-m-6 flex min-h-screen flex-col bg-[#F4F6F8]">
      <TemplateEditor
        procedureTypeName={procedureType.name}
        procedureTypeCategory={procedureType.category}
        templateId={template?.id ?? null}
        initialSections={template?.sections ?? []}
        onSave={handleSave}
        onResetToDefault={handleResetToDefault}
        onBack={handleBack}
      />
    </div>
  )
}
