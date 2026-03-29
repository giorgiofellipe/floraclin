'use client'

import * as React from 'react'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { cn } from '@/lib/utils'
import type { EvaluationSection, EvaluationQuestion } from '@/types/evaluation'
import type { DiagramPointData, CatalogProduct } from '@/components/face-diagram/types'
import type { WizardOverrides } from '@/components/service-wizard/types'
import {
  RadioQuestion,
  CheckboxQuestion,
  ScaleQuestion,
  TextQuestion,
  CheckboxWithOtherQuestion,
  RadioWithOtherQuestion,
  FaceDiagramQuestion,
} from './question-renderers'

// ─── Types ─────────────────────────────────────────────────────────

export interface TemplateRendererProps {
  sections: EvaluationSection[]
  responses: Record<string, unknown>
  onChange: (responses: Record<string, unknown>) => void
  readOnly?: boolean
  patientGender?: string | null
  diagramPoints?: DiagramPointData[]
  onDiagramChange?: (points: DiagramPointData[]) => void
  diagramRendered?: boolean
  products?: CatalogProduct[]
  wizardOverrides?: WizardOverrides
}

// ─── Helpers ───────────────────────────────────────────────────────

function isQuestionAnswered(question: EvaluationQuestion, value: unknown): boolean {
  if (value === undefined || value === null) return false

  switch (question.type) {
    case 'radio':
      return typeof value === 'string' && value.length > 0
    case 'checkbox':
      return Array.isArray(value) && value.length > 0
    case 'scale':
      return typeof value === 'number'
    case 'text':
      return typeof value === 'string' && value.trim().length > 0
    case 'checkbox_with_other': {
      const v = value as { selected?: string[]; other?: string }
      return (v.selected && v.selected.length > 0) || (typeof v.other === 'string' && v.other.trim().length > 0)
    }
    case 'radio_with_other': {
      const v = value as { selected?: string; other?: string }
      return (typeof v.selected === 'string' && v.selected.length > 0) || (typeof v.other === 'string' && v.other.trim().length > 0)
    }
    case 'face_diagram':
      return !!(value as { completed?: boolean })?.completed
    default:
      return false
  }
}

function getSectionCompletion(
  section: EvaluationSection,
  responses: Record<string, unknown>
): { answered: number; total: number } {
  const total = section.questions.length
  const answered = section.questions.filter((q) =>
    isQuestionAnswered(q, responses[q.id])
  ).length
  return { answered, total }
}

// ─── Component ─────────────────────────────────────────────────────

export function TemplateRenderer({
  sections,
  responses,
  onChange,
  readOnly = false,
  patientGender,
  diagramPoints,
  onDiagramChange,
  diagramRendered = false,
  products,
}: TemplateRendererProps) {
  const sortedSections = React.useMemo(
    () => [...sections].sort((a, b) => a.order - b.order),
    [sections]
  )

  // Pre-compute which face_diagram question ID gets the real diagram (first occurrence only)
  const firstDiagramQuestionId = React.useMemo(() => {
    for (const section of [...sections].sort((a, b) => a.order - b.order)) {
      for (const question of [...section.questions].sort((a, b) => a.order - b.order)) {
        if (question.type === 'face_diagram') {
          return question.id
        }
      }
    }
    return null
  }, [sections])

  function updateResponse(questionId: string, value: unknown) {
    onChange({ ...responses, [questionId]: value })
  }

  // Default all sections open
  const defaultOpen = React.useMemo(
    () => sortedSections.map((s) => s.id),
    [sortedSections]
  )

  return (
    <Accordion multiple defaultValue={defaultOpen} className="flex flex-col gap-0">
      {sortedSections.map((section, sectionIndex) => {
        const { answered, total } = getSectionCompletion(section, responses)
        const isComplete = answered === total && total > 0
        const sortedQuestions = [...section.questions].sort(
          (a, b) => a.order - b.order
        )

        return (
          <AccordionItem
            key={section.id}
            value={section.id}
            className={cn(
              'rounded-[3px] border px-5 mb-3 transition-colors duration-200 overflow-hidden',
              isComplete
                ? 'border-sage/20 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]'
                : 'border-[#E8ECEF] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]'
            )}
          >
            <AccordionTrigger className="py-4 hover:no-underline">
              <div className="flex w-full items-center justify-between">
                <div className="flex items-center gap-2.5">
                  {/* Numbered circle */}
                  <div
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                      isComplete
                        ? 'bg-sage/15 text-sage'
                        : 'bg-forest/10 text-forest'
                    )}
                  >
                    {sectionIndex + 1}
                  </div>
                  <span
                    className={cn(
                      'text-sm font-medium transition-colors',
                      isComplete ? 'text-forest' : 'text-charcoal'
                    )}
                  >
                    {section.title}
                  </span>
                </div>

                {/* Completion indicator */}
                <span className="mr-2 text-xs text-mid">
                  {answered}/{total} respondidas
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-5 pt-1">
              <div className="flex flex-col gap-5">
                {sortedQuestions.map((question) => {
                  // Show diagram as already rendered for all face_diagram questions
                  // except the very first one across the entire template
                  const showDiagramAsRendered =
                    question.type === 'face_diagram' &&
                    (diagramRendered || question.id !== firstDiagramQuestionId)

                  return (
                    <QuestionRenderer
                      key={question.id}
                      question={question}
                      value={responses[question.id]}
                      onChange={(v) => updateResponse(question.id, v)}
                      readOnly={readOnly}
                      diagramRendered={showDiagramAsRendered}
                      diagramPoints={diagramPoints}
                      onDiagramChange={onDiagramChange}
                      patientGender={patientGender}
                      products={products}
                    />
                  )
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        )
      })}
    </Accordion>
  )
}

// ─── Question dispatcher ───────────────────────────────────────────

interface QuestionRendererProps {
  question: EvaluationQuestion
  value: unknown
  onChange: (value: unknown) => void
  readOnly?: boolean
  diagramRendered?: boolean
  diagramPoints?: DiagramPointData[]
  onDiagramChange?: (points: DiagramPointData[]) => void
  patientGender?: string | null
  products?: CatalogProduct[]
}

function QuestionRenderer({
  question,
  value,
  onChange,
  readOnly,
  diagramRendered,
  diagramPoints,
  onDiagramChange,
  patientGender,
  products,
}: QuestionRendererProps) {
  switch (question.type) {
    case 'radio':
      return (
        <RadioQuestion
          question={question}
          value={value as string | undefined}
          onChange={onChange}
          readOnly={readOnly}
        />
      )
    case 'checkbox':
      return (
        <CheckboxQuestion
          question={question}
          value={value as string[] | undefined}
          onChange={onChange}
          readOnly={readOnly}
        />
      )
    case 'scale':
      return (
        <ScaleQuestion
          question={question}
          value={value as number | undefined}
          onChange={onChange}
          readOnly={readOnly}
        />
      )
    case 'text':
      return (
        <TextQuestion
          question={question}
          value={value as string | undefined}
          onChange={onChange}
          readOnly={readOnly}
        />
      )
    case 'checkbox_with_other':
      return (
        <CheckboxWithOtherQuestion
          question={question}
          value={value as { selected: string[]; other: string } | undefined}
          onChange={onChange}
          readOnly={readOnly}
        />
      )
    case 'radio_with_other':
      return (
        <RadioWithOtherQuestion
          question={question}
          value={value as { selected: string; other: string } | undefined}
          onChange={onChange}
          readOnly={readOnly}
        />
      )
    case 'face_diagram':
      return (
        <FaceDiagramQuestion
          question={question}
          diagramRendered={diagramRendered}
          diagramPoints={diagramPoints}
          onDiagramChange={onDiagramChange}
          patientGender={patientGender}
          products={products}
          readOnly={readOnly}
        />
      )
    default:
      return null
  }
}
