'use client'

import { useMemo, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useProcedureTypes } from '@/hooks/queries/use-procedure-types'
import { useEvaluationTemplates } from '@/hooks/queries/use-evaluation'
import type { EvaluationSection } from '@/types/evaluation'

interface ProcedureTypeSummary {
  id: string
  name: string
}

interface TemplateSummary {
  procedureTypeId: string
  sections: EvaluationSection[]
}

interface CopyOption {
  procedureTypeId: string
  name: string
  questionCount: number
  sections: EvaluationSection[]
}

interface CopyTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentProcedureTypeId: string
  onCopy: (sections: EvaluationSection[]) => void
}

export function CopyTemplateDialog({
  open,
  onOpenChange,
  currentProcedureTypeId,
  onCopy,
}: CopyTemplateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Copiar de outro procedimento</DialogTitle>
        </DialogHeader>
        <CopyTemplateDialogBody
          currentProcedureTypeId={currentProcedureTypeId}
          onCopy={onCopy}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  )
}

function DialogMessage({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-mid">{children}</p>
}

function CopyTemplateDialogBody({
  currentProcedureTypeId,
  onCopy,
  onOpenChange,
}: Omit<CopyTemplateDialogProps, 'open'>) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const {
    data: types,
    isLoading: typesLoading,
    isError: typesError,
  } = useProcedureTypes()

  const procedureTypes = useMemo(() => (types ?? []) as ProcedureTypeSummary[], [types])

  const otherIds = useMemo(
    () => procedureTypes.filter((t) => t.id !== currentProcedureTypeId).map((t) => t.id),
    [procedureTypes, currentProcedureTypeId],
  )

  const {
    data: templates,
    isLoading: templatesLoading,
    isError: templatesError,
  } = useEvaluationTemplates(otherIds)

  const options = useMemo<CopyOption[]>(() => {
    const names = new Map(procedureTypes.map((t) => [t.id, t.name]))
    return ((templates ?? []) as TemplateSummary[])
      .filter((t) => t.sections.length > 0 && names.has(t.procedureTypeId))
      .map((t) => ({
        procedureTypeId: t.procedureTypeId,
        name: names.get(t.procedureTypeId)!,
        questionCount: t.sections.reduce((sum, s) => sum + s.questions.length, 0),
        sections: t.sections,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }, [procedureTypes, templates])

  // Not isPending: with no other procedure types the templates query is disabled and stays pending forever.
  const loading = typesLoading || templatesLoading
  const selected = options.find((o) => o.procedureTypeId === selectedId)

  function handleConfirm() {
    if (!selected) return
    onCopy(structuredClone(selected.sections))
    onOpenChange(false)
  }

  if (loading) return <DialogMessage>Carregando...</DialogMessage>
  if (typesError || templatesError) {
    return <DialogMessage>Erro ao carregar as fichas. Tente novamente.</DialogMessage>
  }
  if (options.length === 0) {
    return <DialogMessage>Nenhum outro procedimento tem ficha de avaliação ainda.</DialogMessage>
  }

  if (selected) {
    return (
      <>
        <p className="text-sm text-charcoal">
          Copiar a ficha de <strong>{selected.name}</strong>? Isso substitui as
          perguntas atuais desta ficha.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setSelectedId(null)}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} autoFocus>
            Copiar
          </Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {options.map((option) => (
        <li key={option.procedureTypeId}>
          <button
            type="button"
            onClick={() => setSelectedId(option.procedureTypeId)}
            className="w-full rounded-[3px] border border-sage/20 hover:border-sage/40 px-3 py-2 text-left transition-colors"
          >
            <span className="block text-sm font-medium text-charcoal">
              {option.name}
            </span>
            <span className="block text-xs text-mid">
              {option.questionCount === 1
                ? '1 pergunta'
                : `${option.questionCount} perguntas`}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
