'use client'

import { useState } from 'react'
import isEqual from 'fast-deep-equal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SectionEditor } from './section-editor'
import { QuestionEditorDialog } from './question-editor-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import {
  ArrowLeftIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  Loader2Icon,
} from 'lucide-react'
import { generateFormId } from '@/lib/forms/constants'
import type { FormQuestion, FormQuestionType, FormSection } from '@/lib/forms/types'

export interface FormTemplateEditorProps {
  title?: string
  subtitle?: string
  sections: FormSection[]
  savedSections: FormSection[]
  onSectionsChange: (sections: FormSection[]) => void
  allowedTypes: readonly FormQuestionType[]
  onSave: (sections: FormSection[]) => Promise<{ success?: boolean; error?: string } | null>
  /** Omit to hide "Restaurar padrão". */
  onResetToDefault?: () => Promise<{ success?: boolean; error?: string; sections?: FormSection[] } | null>
  headerActions?: React.ReactNode | ((state: { busy: boolean }) => React.ReactNode)
  emptyStateHint: string
  /** Omit to render embedded (no sticky full-width bar, no back button). */
  onBack?: () => void
}

export function FormTemplateEditor({
  title,
  subtitle,
  sections,
  savedSections,
  onSectionsChange: setSections,
  allowedTypes,
  onSave,
  onResetToDefault,
  headerActions,
  emptyStateHint,
  onBack,
}: FormTemplateEditorProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)

  const [questionDialogOpen, setQuestionDialogOpen] = useState(false)
  const [editingQuestion, setEditingQuestion] = useState<FormQuestion | null>(null)
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)

  const [newSectionTitle, setNewSectionTitle] = useState('')
  const [showNewSectionInput, setShowNewSectionInput] = useState(false)

  const hasChanges = !isEqual(sections, savedSections)

  function handleAddSection() {
    if (!newSectionTitle.trim()) return

    const newSection: FormSection = {
      id: generateFormId(),
      title: newSectionTitle.trim(),
      order: sections.length,
      questions: [],
    }

    setSections([...sections, newSection])
    setNewSectionTitle('')
    setShowNewSectionInput(false)
  }

  function handleDeleteSection(sectionId: string) {
    setSections(
      sections
        .filter((s) => s.id !== sectionId)
        .map((s, i) => ({ ...s, order: i }))
    )
  }

  function moveSection(index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= sections.length) return
    const newSections = [...sections]
    ;[newSections[index], newSections[target]] = [newSections[target], newSections[index]]
    setSections(newSections.map((s, i) => ({ ...s, order: i })))
  }

  function handleUpdateSectionTitle(sectionId: string, title: string) {
    setSections(
      sections.map((s) => (s.id === sectionId ? { ...s, title } : s))
    )
  }

  function handleOpenAddQuestion(sectionId: string) {
    setEditingSectionId(sectionId)
    setEditingQuestion(null)
    setQuestionDialogOpen(true)
  }

  function handleOpenEditQuestion(sectionId: string, question: FormQuestion) {
    setEditingSectionId(sectionId)
    setEditingQuestion(question)
    setQuestionDialogOpen(true)
  }

  function handleSaveQuestion(data: Omit<FormQuestion, 'id' | 'order'>) {
    if (!editingSectionId) return

    setSections(
      sections.map((section) => {
        if (section.id !== editingSectionId) return section

        if (editingQuestion) {
          return {
            ...section,
            questions: section.questions.map((q) =>
              q.id === editingQuestion.id
                ? { ...data, id: editingQuestion.id, order: editingQuestion.order }
                : q
            ),
          }
        } else {
          const newQuestion: FormQuestion = {
            ...data,
            id: generateFormId(),
            order: section.questions.length,
          }
          return {
            ...section,
            questions: [...section.questions, newQuestion],
          }
        }
      })
    )
  }

  function handleDeleteQuestion(sectionId: string, questionId: string) {
    setSections(
      sections.map((section) => {
        if (section.id !== sectionId) return section
        return {
          ...section,
          questions: section.questions
            .filter((q) => q.id !== questionId)
            .map((q, i) => ({ ...q, order: i })),
        }
      })
    )
  }

  function moveQuestion(sectionId: string, questionId: string, delta: -1 | 1) {
    setSections(
      sections.map((section) => {
        if (section.id !== sectionId) return section
        const index = section.questions.findIndex((q) => q.id === questionId)
        const target = index + delta
        if (index === -1 || target < 0 || target >= section.questions.length) return section
        const newQuestions = [...section.questions]
        ;[newQuestions[index], newQuestions[target]] = [newQuestions[target], newQuestions[index]]
        return {
          ...section,
          questions: newQuestions.map((q, i) => ({ ...q, order: i })),
        }
      })
    )
  }

  async function handleSave() {
    setIsSaving(true)
    try {
      const result = await onSave(sections)
      if (result?.success) {
        toast.success('Modelo salvo com sucesso')
      } else {
        toast.error(result?.error || 'Erro ao salvar modelo')
      }
    } catch {
      toast.error('Erro ao salvar modelo')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleResetToDefault() {
    setIsResetting(true)
    try {
      const result = await onResetToDefault?.()
      if (result?.success && result.sections) {
        setSections(result.sections)
        toast.success('Modelo restaurado ao padrão')
      } else if (result?.error) {
        toast.error(result.error)
      }
    } catch {
      toast.error('Erro ao restaurar modelo')
    } finally {
      setIsResetting(false)
      setResetConfirm(false)
    }
  }

  const resetConfirmControl = (
    <div className="flex items-center gap-1">
      <span className="text-xs text-mid">Restaurar padrão?</span>
      <Button
        variant="destructive"
        size="xs"
        onClick={handleResetToDefault}
        disabled={isResetting}
      >
        {isResetting ? (
          <Loader2Icon className="h-3 w-3 animate-spin" />
        ) : (
          'Confirmar'
        )}
      </Button>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setResetConfirm(false)}
      >
        Cancelar
      </Button>
    </div>
  )

  const secondaryActions = (
    <>
      {typeof headerActions === 'function' ? headerActions({ busy: isSaving || isResetting }) : headerActions}
      <div className="hidden sm:flex items-center gap-2">
        {onResetToDefault && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setResetConfirm(true)}
            disabled={isSaving}
          >
            <RotateCcwIcon data-icon="inline-start" />
            Restaurar padrão
          </Button>
        )}
      </div>

      {onResetToDefault && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="icon-sm"
                className="sm:hidden"
                aria-label="Mais ações"
              />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto whitespace-nowrap">
            <DropdownMenuItem onClick={() => setResetConfirm(true)} disabled={isSaving}>
              <RotateCcwIcon />
              Restaurar padrão
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  )

  const toolbar = (
    <div className="flex items-center gap-2">
      {resetConfirm ? resetConfirmControl : secondaryActions}

      <Button size="sm" onClick={handleSave} disabled={isSaving || !hasChanges}>
        {isSaving ? (
          <Loader2Icon data-icon="inline-start" className="animate-spin" />
        ) : (
          <SaveIcon data-icon="inline-start" />
        )}
        Salvar
      </Button>
    </div>
  )

  const totalQuestions = sections.reduce((sum, s) => sum + s.questions.length, 0)

  return (
    // Full-page mode cancels the platform <main> padding so the sticky bar spans edge to edge.
    <div className={onBack ? 'min-h-screen -m-4 md:-m-6' : 'space-y-4'}>
      {onBack ? (
        // z-30 so it overlays the platform layout header
        <div className="sticky top-0 z-30 bg-white border-b border-[#E8ECEF] shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-2 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Voltar">
                <ArrowLeftIcon className="h-4 w-4" />
              </Button>
              {title && (
                <div className="min-w-0">
                  <h1 className="text-base font-medium leading-tight text-charcoal line-clamp-2 sm:truncate">{title}</h1>
                  {subtitle && <p className="text-xs text-mid truncate">{subtitle}</p>}
                </div>
              )}
            </div>
            {toolbar}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          {title ? (
            <div className="min-w-0">
              <h2 className="text-base font-medium text-charcoal truncate">{title}</h2>
              {subtitle && <p className="text-xs text-mid truncate">{subtitle}</p>}
            </div>
          ) : (
            <span />
          )}
          {toolbar}
        </div>
      )}

      <div className={onBack ? 'max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-4' : 'space-y-4'}>
        <div className="flex items-center gap-4 text-sm text-mid">
          <span>{sections.length} {sections.length === 1 ? 'seção' : 'seções'}</span>
          <span className="text-mid/30">|</span>
          <span>{totalQuestions} {totalQuestions === 1 ? 'pergunta' : 'perguntas'}</span>
          {hasChanges && (
            <>
              <span className="text-mid/30">|</span>
              <span className="text-amber-dark">Alterações não salvas</span>
            </>
          )}
        </div>

        {sections.map((section, index) => (
          <SectionEditor
            key={section.id}
            section={section}
            sectionIndex={index}
            totalSections={sections.length}
            onMoveUp={() => moveSection(index, -1)}
            onMoveDown={() => moveSection(index, 1)}
            onDelete={() => handleDeleteSection(section.id)}
            onUpdateTitle={(title) => handleUpdateSectionTitle(section.id, title)}
            onAddQuestion={() => handleOpenAddQuestion(section.id)}
            onEditQuestion={(question) => handleOpenEditQuestion(section.id, question)}
            onDeleteQuestion={(questionId) => handleDeleteQuestion(section.id, questionId)}
            onMoveQuestionUp={(questionId) => moveQuestion(section.id, questionId, -1)}
            onMoveQuestionDown={(questionId) => moveQuestion(section.id, questionId, 1)}
          />
        ))}

        {showNewSectionInput ? (
          <div className="bg-white rounded-[3px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
            <div className="space-y-2">
              <Label className="uppercase tracking-wider text-xs text-mid">
                Título da seção
              </Label>
              <div className="flex gap-2">
                <Input
                  value={newSectionTitle}
                  onChange={(e) => setNewSectionTitle(e.target.value)}
                  placeholder="Ex: Histórico do paciente"
                  className="flex-1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newSectionTitle.trim()) {
                      handleAddSection()
                    } else if (e.key === 'Escape') {
                      setShowNewSectionInput(false)
                      setNewSectionTitle('')
                    }
                  }}
                />
                <Button
                  onClick={handleAddSection}
                  disabled={!newSectionTitle.trim()}
                  size="sm"
                >
                  Adicionar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowNewSectionInput(false)
                    setNewSectionTitle('')
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowNewSectionInput(true)}
            className="w-full rounded-[3px] border-2 border-dashed border-sage/20 hover:border-sage/40 py-6 flex items-center justify-center gap-2 text-sm text-sage hover:text-forest transition-colors"
          >
            <PlusIcon className="h-4 w-4" />
            Adicionar seção
          </button>
        )}

        {sections.length === 0 && !showNewSectionInput && (
          <div className="text-center py-12">
            <p className="text-sm text-mid mb-2">
              Nenhuma seção adicionada ainda.
            </p>
            <p className="text-xs text-mid/60">
              {emptyStateHint}
            </p>
          </div>
        )}
      </div>

      <QuestionEditorDialog
        open={questionDialogOpen}
        onOpenChange={setQuestionDialogOpen}
        question={editingQuestion}
        allowedTypes={allowedTypes}
        onSave={handleSaveQuestion}
      />
    </div>
  )
}
