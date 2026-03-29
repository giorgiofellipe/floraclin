'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  ArrowUpIcon,
  ArrowDownIcon,
  GripVerticalIcon,
} from 'lucide-react'
import type { EvaluationQuestion, EvaluationSection } from '@/types/evaluation'

const QUESTION_TYPE_LABELS: Record<string, string> = {
  radio: 'Escolha unica',
  checkbox: 'Multipla escolha',
  scale: 'Escala',
  text: 'Texto livre',
  checkbox_with_other: 'Multipla escolha + Outro',
  radio_with_other: 'Escolha unica + Outro',
  face_diagram: 'Diagrama facial',
}

interface SectionEditorProps {
  section: EvaluationSection
  sectionIndex: number
  totalSections: number
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  onUpdateTitle: (title: string) => void
  onAddQuestion: () => void
  onEditQuestion: (question: EvaluationQuestion) => void
  onDeleteQuestion: (questionId: string) => void
  onMoveQuestionUp: (questionId: string) => void
  onMoveQuestionDown: (questionId: string) => void
}

export function SectionEditor({
  section,
  sectionIndex,
  totalSections,
  onMoveUp,
  onMoveDown,
  onDelete,
  onUpdateTitle,
  onAddQuestion,
  onEditQuestion,
  onDeleteQuestion,
  onMoveQuestionUp,
  onMoveQuestionDown,
}: SectionEditorProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(section.title)
  const [deleteQuestionConfirm, setDeleteQuestionConfirm] = useState<string | null>(null)
  const [deleteSectionConfirm, setDeleteSectionConfirm] = useState(false)

  function handleTitleSave() {
    if (titleValue.trim()) {
      onUpdateTitle(titleValue.trim())
    } else {
      setTitleValue(section.title)
    }
    setIsEditingTitle(false)
  }

  function handleTitleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      handleTitleSave()
    } else if (e.key === 'Escape') {
      setTitleValue(section.title)
      setIsEditingTitle(false)
    }
  }

  return (
    <div className="bg-white rounded-[3px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
      {/* Section header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#E8ECEF]">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onMoveUp}
            disabled={sectionIndex === 0}
            title="Mover secao para cima"
          >
            <ArrowUpIcon className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onMoveDown}
            disabled={sectionIndex === totalSections - 1}
            title="Mover secao para baixo"
          >
            <ArrowDownIcon className="h-3 w-3" />
          </Button>
        </div>

        <GripVerticalIcon className="h-4 w-4 text-mid/40" />

        {isEditingTitle ? (
          <input
            type="text"
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={handleTitleKeyDown}
            className="flex-1 text-sm font-medium text-charcoal bg-transparent border-b border-sage/40 outline-none py-0.5"
            autoFocus
          />
        ) : (
          <button
            type="button"
            className="flex-1 text-left text-sm font-medium text-charcoal hover:text-sage transition-colors"
            onClick={() => setIsEditingTitle(true)}
            title="Clique para editar o titulo"
          >
            {section.title}
          </button>
        )}

        <span className="text-xs text-mid">
          {section.questions.length} {section.questions.length === 1 ? 'pergunta' : 'perguntas'}
        </span>

        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          {isCollapsed ? (
            <ChevronDownIcon className="h-3.5 w-3.5" />
          ) : (
            <ChevronUpIcon className="h-3.5 w-3.5" />
          )}
        </Button>

        {deleteSectionConfirm ? (
          <div className="flex items-center gap-1">
            <Button
              variant="destructive"
              size="xs"
              onClick={() => {
                onDelete()
                setDeleteSectionConfirm(false)
              }}
            >
              Confirmar
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setDeleteSectionConfirm(false)}
            >
              Cancelar
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setDeleteSectionConfirm(true)}
            title="Excluir secao"
          >
            <Trash2Icon className="h-3.5 w-3.5 text-red-500" />
          </Button>
        )}
      </div>

      {/* Questions list */}
      {!isCollapsed && (
        <div className="divide-y divide-[#E8ECEF]">
          {section.questions.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-mid">
                Nenhuma pergunta nesta secao.
              </p>
            </div>
          ) : (
            section.questions.map((question, qIndex) => (
              <div
                key={question.id}
                className="flex items-center gap-2 px-4 py-2.5 hover:bg-cream/40 transition-colors group"
              >
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onMoveQuestionUp(question.id)}
                    disabled={qIndex === 0}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <ArrowUpIcon className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onMoveQuestionDown(question.id)}
                    disabled={qIndex === section.questions.length - 1}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <ArrowDownIcon className="h-3 w-3" />
                  </Button>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-charcoal truncate">
                      {question.label}
                    </span>
                    {question.required && (
                      <span className="text-xs text-amber-dark font-medium">*</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-mid">
                      {QUESTION_TYPE_LABELS[question.type] || question.type}
                    </span>
                    {question.options && question.options.length > 0 && (
                      <span className="text-xs text-mid/60">
                        ({question.options.length} opcoes)
                      </span>
                    )}
                    {question.warningText && (
                      <span className="text-xs text-amber-dark" title={question.warningText}>
                        Alerta
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onEditQuestion(question)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <PencilIcon className="h-3.5 w-3.5" />
                  </Button>

                  {deleteQuestionConfirm === question.id ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="destructive"
                        size="xs"
                        onClick={() => {
                          onDeleteQuestion(question.id)
                          setDeleteQuestionConfirm(null)
                        }}
                      >
                        Sim
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setDeleteQuestionConfirm(null)}
                      >
                        Nao
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setDeleteQuestionConfirm(question.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2Icon className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Add question button */}
          <div className="px-4 py-2.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={onAddQuestion}
              className="w-full justify-center text-sage hover:text-forest"
            >
              <PlusIcon data-icon="inline-start" />
              Adicionar pergunta
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
