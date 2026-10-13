'use client'

import * as React from 'react'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { cn } from '@/lib/utils'
import { isQuestionAnswered } from '@/lib/forms/answers'
import type { FormQuestion, FormSection } from '@/lib/forms/types'
import {
  RadioQuestion,
  CheckboxQuestion,
  ScaleQuestion,
  TextQuestion,
  CheckboxWithOtherQuestion,
  RadioWithOtherQuestion,
  ListQuestion,
} from './question-renderers'

export interface FormRendererProps {
  sections: FormSection[]
  responses: Record<string, unknown>
  onChange: (responses: Record<string, unknown>) => void
  readOnly?: boolean
  showErrors?: boolean
  /** Return a node to replace the default renderer for a question, or undefined to keep it. */
  renderQuestion?: (question: FormQuestion) => React.ReactNode | undefined
}

// ─── Helpers ───────────────────────────────────────────────────────

function getSectionCompletion(
  section: FormSection,
  responses: Record<string, unknown>
): { answered: number; total: number } {
  const total = section.questions.length
  const answered = section.questions.filter((q) =>
    isQuestionAnswered(q, responses[q.id])
  ).length
  return { answered, total }
}

// ─── Component ─────────────────────────────────────────────────────

export function FormRenderer({
  sections,
  responses,
  onChange,
  readOnly = false,
  showErrors = false,
  renderQuestion,
}: FormRendererProps) {
  const sortedSections = React.useMemo(
    () => [...sections].sort((a, b) => a.order - b.order),
    [sections]
  )

  function updateResponse(questionId: string, value: unknown) {
    onChange({ ...responses, [questionId]: value })
  }

  return (
    <Accordion multiple defaultValue={sortedSections.map((s) => s.id)} className="flex flex-col gap-0">
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
              'rounded-[3px] border bg-white px-5 mb-3 shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-colors duration-200 overflow-hidden',
              isComplete ? 'border-sage/20' : 'border-topbar-border'
            )}
          >
            <AccordionTrigger className="py-4 hover:no-underline">
              <div className="flex w-full items-center justify-between">
                <div className="flex items-center gap-2.5">
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

                <span className="mr-2 text-xs text-mid">
                  {answered}/{total} respondidas
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-5 pt-1">
              <div className="flex flex-col gap-5">
                {sortedQuestions.map((question) => (
                  <QuestionRenderer
                    key={question.id}
                    question={question}
                    value={responses[question.id]}
                    onChange={(v) => updateResponse(question.id, v)}
                    readOnly={readOnly}
                    showErrors={showErrors}
                    renderQuestion={renderQuestion}
                  />
                ))}
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
  question: FormQuestion
  value: unknown
  onChange: (value: unknown) => void
  readOnly?: boolean
  showErrors?: boolean
  renderQuestion?: FormRendererProps['renderQuestion']
}

function QuestionRenderer({ question, value, onChange, readOnly, showErrors, renderQuestion }: QuestionRendererProps) {
  const custom = renderQuestion?.(question)
  if (custom !== undefined) return custom

  switch (question.type) {
    case 'radio':
      return (
        <RadioQuestion
          question={question}
          value={value as string | undefined}
          onChange={onChange}
          readOnly={readOnly}
          showErrors={showErrors}
        />
      )
    case 'checkbox':
      return (
        <CheckboxQuestion
          question={question}
          value={value as string[] | undefined}
          onChange={onChange}
          readOnly={readOnly}
          showErrors={showErrors}
        />
      )
    case 'scale':
      return (
        <ScaleQuestion
          question={question}
          value={value as number | undefined}
          onChange={onChange}
          readOnly={readOnly}
          showErrors={showErrors}
        />
      )
    case 'text':
      return (
        <TextQuestion
          question={question}
          value={value as string | undefined}
          onChange={onChange}
          readOnly={readOnly}
          showErrors={showErrors}
        />
      )
    case 'checkbox_with_other':
      return (
        <CheckboxWithOtherQuestion
          question={question}
          value={value as { selected: string[]; other: string } | undefined}
          onChange={onChange}
          readOnly={readOnly}
          showErrors={showErrors}
        />
      )
    case 'radio_with_other':
      return (
        <RadioWithOtherQuestion
          question={question}
          value={value as { selected: string; other: string } | undefined}
          onChange={onChange}
          readOnly={readOnly}
          showErrors={showErrors}
        />
      )
    case 'list':
      return (
        <ListQuestion
          question={question}
          value={value as Record<string, string>[] | undefined}
          onChange={onChange}
          readOnly={readOnly}
          showErrors={showErrors}
        />
      )
    default:
      return null
  }
}
