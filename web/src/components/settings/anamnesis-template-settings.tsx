'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { FormTemplateEditor } from '@/components/forms/form-template-editor'
import { useAnamnesisTemplate } from '@/hooks/queries/use-anamnesis'
import { useSaveAnamnesisTemplate } from '@/hooks/mutations/use-anamnesis-mutations'
import { BASE_QUESTION_TYPES } from '@/lib/forms/types'
import type { FormSection } from '@/lib/forms/types'

export function AnamnesisTemplateSettings() {
  const { data: template, isLoading, isError } = useAnamnesisTemplate()
  const saveTemplate = useSaveAnamnesisTemplate()
  const [draft, setDraft] = useState<FormSection[] | null>(null)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-mid" />
        <span className="ml-2 text-sm text-mid">Carregando modelo...</span>
      </div>
    )
  }
  if (isError || !template) {
    return <div className="py-12 text-center text-sm text-mid">Erro ao carregar o modelo de anamnese.</div>
  }

  async function handleSave(sections: FormSection[]) {
    try {
      await saveTemplate.mutateAsync({ action: 'update', sections })
      return { success: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Erro ao salvar modelo' }
    }
  }

  async function handleReset() {
    try {
      const result = await saveTemplate.mutateAsync({ action: 'reset' })
      return { success: true, sections: result.data.sections }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Erro ao restaurar modelo' }
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-mid">
        {template.version === 0 ? 'Modelo padrão.' : `Versão ${template.version}.`} As alterações valem para novas
        anamneses. Anamneses já salvas mantêm o modelo com que foram respondidas.
      </p>
      <FormTemplateEditor
        sections={draft ?? template.sections}
        savedSections={template.sections}
        onSectionsChange={setDraft}
        allowedTypes={BASE_QUESTION_TYPES}
        onSave={handleSave}
        onResetToDefault={handleReset}
        emptyStateHint="Adicione seções e perguntas ou restaure o modelo padrão."
      />
    </div>
  )
}
