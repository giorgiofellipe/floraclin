'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SectionEditor } from './section-editor'
import { QuestionEditorDialog } from './question-editor-dialog'
import { toast } from 'sonner'
import {
  ArrowLeftIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  Loader2Icon,
} from 'lucide-react'
import type {
  EvaluationSection,
  EvaluationQuestion,
  ProcedureCategory,
} from '@/types/evaluation'

function generateId(): string {
  return crypto.randomUUID()
}

interface TemplateEditorProps {
  procedureTypeName: string
  procedureTypeCategory: string
  templateId: string | null
  initialSections: EvaluationSection[]
  onSave: (sections: EvaluationSection[]) => Promise<{ success?: boolean; error?: string } | null>
  onResetToDefault: () => Promise<{ success?: boolean; error?: string; sections?: EvaluationSection[] } | null>
  onBack: () => void
}

export function TemplateEditor({
  procedureTypeName,
  procedureTypeCategory,
  templateId,
  initialSections,
  onSave,
  onResetToDefault,
  onBack,
}: TemplateEditorProps) {
  const [sections, setSections] = useState<EvaluationSection[]>(initialSections)
  const [isSaving, setIsSaving] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)

  // Question editor state
  const [questionDialogOpen, setQuestionDialogOpen] = useState(false)
  const [editingQuestion, setEditingQuestion] = useState<EvaluationQuestion | null>(null)
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)

  // New section state
  const [newSectionTitle, setNewSectionTitle] = useState('')
  const [showNewSectionInput, setShowNewSectionInput] = useState(false)

  const hasChanges = JSON.stringify(sections) !== JSON.stringify(initialSections)

  // ─── Section operations ──────────────────────────────────────────

  function handleAddSection() {
    if (!newSectionTitle.trim()) return

    const newSection: EvaluationSection = {
      id: generateId(),
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

  function handleMoveSectionUp(index: number) {
    if (index === 0) return
    const newSections = [...sections]
    ;[newSections[index - 1], newSections[index]] = [newSections[index], newSections[index - 1]]
    setSections(newSections.map((s, i) => ({ ...s, order: i })))
  }

  function handleMoveSectionDown(index: number) {
    if (index === sections.length - 1) return
    const newSections = [...sections]
    ;[newSections[index], newSections[index + 1]] = [newSections[index + 1], newSections[index]]
    setSections(newSections.map((s, i) => ({ ...s, order: i })))
  }

  function handleUpdateSectionTitle(sectionId: string, title: string) {
    setSections(
      sections.map((s) => (s.id === sectionId ? { ...s, title } : s))
    )
  }

  // ─── Question operations ─────────────────────────────────────────

  function handleOpenAddQuestion(sectionId: string) {
    setEditingSectionId(sectionId)
    setEditingQuestion(null)
    setQuestionDialogOpen(true)
  }

  function handleOpenEditQuestion(sectionId: string, question: EvaluationQuestion) {
    setEditingSectionId(sectionId)
    setEditingQuestion(question)
    setQuestionDialogOpen(true)
  }

  function handleSaveQuestion(data: Omit<EvaluationQuestion, 'id' | 'order'>) {
    if (!editingSectionId) return

    setSections(
      sections.map((section) => {
        if (section.id !== editingSectionId) return section

        if (editingQuestion) {
          // Editing existing question
          return {
            ...section,
            questions: section.questions.map((q) =>
              q.id === editingQuestion.id
                ? { ...q, ...data }
                : q
            ),
          }
        } else {
          // Adding new question
          const newQuestion: EvaluationQuestion = {
            ...data,
            id: generateId(),
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

  function handleMoveQuestionUp(sectionId: string, questionId: string) {
    setSections(
      sections.map((section) => {
        if (section.id !== sectionId) return section
        const index = section.questions.findIndex((q) => q.id === questionId)
        if (index <= 0) return section
        const newQuestions = [...section.questions]
        ;[newQuestions[index - 1], newQuestions[index]] = [newQuestions[index], newQuestions[index - 1]]
        return {
          ...section,
          questions: newQuestions.map((q, i) => ({ ...q, order: i })),
        }
      })
    )
  }

  function handleMoveQuestionDown(sectionId: string, questionId: string) {
    setSections(
      sections.map((section) => {
        if (section.id !== sectionId) return section
        const index = section.questions.findIndex((q) => q.id === questionId)
        if (index === -1 || index === section.questions.length - 1) return section
        const newQuestions = [...section.questions]
        ;[newQuestions[index], newQuestions[index + 1]] = [newQuestions[index + 1], newQuestions[index]]
        return {
          ...section,
          questions: newQuestions.map((q, i) => ({ ...q, order: i })),
        }
      })
    )
  }

  // ─── Save / Reset ────────────────────────────────────────────────

  async function handleSave() {
    setIsSaving(true)
    try {
      const result = await onSave(sections)
      if (result?.success) {
        toast.success('Template salvo com sucesso')
      } else {
        toast.error(result?.error || 'Erro ao salvar template')
      }
    } catch {
      toast.error('Erro ao salvar template')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleResetToDefault() {
    setIsResetting(true)
    try {
      const result = await onResetToDefault()
      if (result?.success && result.sections) {
        setSections(result.sections)
        toast.success('Template restaurado ao padrão')
      } else if (result?.error) {
        toast.error(result.error)
      }
    } catch {
      toast.error('Erro ao restaurar template')
    } finally {
      setIsResetting(false)
      setResetConfirm(false)
    }
  }

  const totalQuestions = sections.reduce((sum, s) => sum + s.questions.length, 0)

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#E8ECEF] shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon-sm" onClick={onBack}>
              <ArrowLeftIcon className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-base font-medium text-charcoal truncate">
                Ficha de Avaliação
              </h1>
              <p className="text-xs text-mid truncate">{procedureTypeName}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {resetConfirm ? (
              <div className="flex items-center gap-1">
                <span className="text-xs text-mid hidden sm:inline">Restaurar padrão?</span>
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
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setResetConfirm(true)}
                disabled={isSaving}
              >
                <RotateCcwIcon data-icon="inline-start" />
                <span className="hidden sm:inline">Restaurar padrão</span>
              </Button>
            )}

            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
            >
              {isSaving ? (
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
              ) : (
                <SaveIcon data-icon="inline-start" />
              )}
              Salvar
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* Stats */}
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

        {/* Sections */}
        {sections.map((section, index) => (
          <SectionEditor
            key={section.id}
            section={section}
            sectionIndex={index}
            totalSections={sections.length}
            onMoveUp={() => handleMoveSectionUp(index)}
            onMoveDown={() => handleMoveSectionDown(index)}
            onDelete={() => handleDeleteSection(section.id)}
            onUpdateTitle={(title) => handleUpdateSectionTitle(section.id, title)}
            onAddQuestion={() => handleOpenAddQuestion(section.id)}
            onEditQuestion={(question) => handleOpenEditQuestion(section.id, question)}
            onDeleteQuestion={(questionId) => handleDeleteQuestion(section.id, questionId)}
            onMoveQuestionUp={(questionId) => handleMoveQuestionUp(section.id, questionId)}
            onMoveQuestionDown={(questionId) => handleMoveQuestionDown(section.id, questionId)}
          />
        ))}

        {/* Add section */}
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

        {/* Empty state */}
        {sections.length === 0 && !showNewSectionInput && (
          <div className="text-center py-12">
            <p className="text-sm text-mid mb-2">
              Nenhuma seção adicionada ainda.
            </p>
            <p className="text-xs text-mid/60">
              Adicione seções e perguntas para criar a ficha de avaliação ou restaure o modelo padrão.
            </p>
          </div>
        )}
      </div>

      {/* Question editor dialog */}
      <QuestionEditorDialog
        open={questionDialogOpen}
        onOpenChange={setQuestionDialogOpen}
        question={editingQuestion}
        onSave={handleSaveQuestion}
      />
    </div>
  )
}
