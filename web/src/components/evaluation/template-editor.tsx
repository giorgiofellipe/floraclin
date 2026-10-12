'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FormTemplateEditor } from '@/components/forms/form-template-editor'
import { CopyTemplateDialog } from './copy-template-dialog'
import { toast } from 'sonner'
import { CopyIcon } from 'lucide-react'
import { BASE_QUESTION_TYPES } from '@/lib/forms/types'
import type { FormQuestionType, FormSection } from '@/lib/forms/types'

const EVALUATION_QUESTION_TYPES: readonly FormQuestionType[] = [...BASE_QUESTION_TYPES, 'face_diagram']

interface TemplateEditorProps {
  procedureTypeName: string
  procedureTypeId: string
  hasDefaultTemplate: boolean
  initialSections: FormSection[]
  onSave: (sections: FormSection[]) => Promise<{ success?: boolean; error?: string } | null>
  onResetToDefault: () => Promise<{ success?: boolean; error?: string; sections?: FormSection[] } | null>
  onBack: () => void
}

export function TemplateEditor({
  procedureTypeName,
  procedureTypeId,
  hasDefaultTemplate,
  initialSections,
  onSave,
  onResetToDefault,
  onBack,
}: TemplateEditorProps) {
  const [sections, setSections] = useState<FormSection[]>(initialSections)
  const [copyDialogOpen, setCopyDialogOpen] = useState(false)

  return (
    <>
      <FormTemplateEditor
        title="Ficha de Avaliação"
        subtitle={procedureTypeName}
        sections={sections}
        savedSections={initialSections}
        onSectionsChange={setSections}
        allowedTypes={EVALUATION_QUESTION_TYPES}
        onSave={onSave}
        onResetToDefault={hasDefaultTemplate ? onResetToDefault : undefined}
        headerActions={({ busy }) => (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setCopyDialogOpen(true)}
            aria-label="Copiar de outro procedimento"
          >
            <CopyIcon data-icon="inline-start" />
            <span className="hidden sm:inline">Copiar de outro procedimento</span>
          </Button>
        )}
        emptyStateHint={
          hasDefaultTemplate
            ? 'Adicione seções e perguntas, restaure o modelo padrão ou copie a ficha de outro procedimento.'
            : 'Adicione seções e perguntas ou copie a ficha de outro procedimento.'
        }
        onBack={onBack}
      />
      <CopyTemplateDialog
        open={copyDialogOpen}
        onOpenChange={setCopyDialogOpen}
        currentProcedureTypeId={procedureTypeId}
        onCopy={(copied) => {
          setSections(copied)
          toast.success('Ficha copiada. Revise e salve.')
        }}
      />
    </>
  )
}
