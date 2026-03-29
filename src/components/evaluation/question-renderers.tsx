'use client'

import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { FaceDiagramEditor } from '@/components/face-diagram/face-diagram-editor'
import type { EvaluationQuestion } from '@/types/evaluation'
import type { DiagramPointData, CatalogProduct } from '@/components/face-diagram/types'

// ─── Shared wrapper ────────────────────────────────────────────────

interface QuestionWrapperProps {
  question: EvaluationQuestion
  children: React.ReactNode
}

function QuestionWrapper({ question, children }: QuestionWrapperProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <Label className="text-sm font-medium text-charcoal">
          {question.label}
          {question.required && <span className="ml-0.5 text-amber">*</span>}
        </Label>
        {question.helpText && (
          <p className="text-xs italic text-mid">{question.helpText}</p>
        )}
      </div>

      {question.warningText && (
        <div className="flex items-start gap-2 rounded-[3px] bg-amber-light px-3 py-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-dark" />
          <span className="text-xs text-amber-dark">{question.warningText}</span>
        </div>
      )}

      {children}
    </div>
  )
}

// ─── Radio ─────────────────────────────────────────────────────────

interface RadioQuestionProps {
  question: EvaluationQuestion
  value: string | undefined
  onChange: (value: string) => void
  readOnly?: boolean
}

export function RadioQuestion({ question, value, onChange, readOnly }: RadioQuestionProps) {
  return (
    <QuestionWrapper question={question}>
      <div className="flex flex-col gap-1.5">
        {question.options?.map((option) => {
          const selected = value === option
          return (
            <button
              key={option}
              type="button"
              disabled={readOnly}
              onClick={() => onChange(option)}
              className={cn(
                'flex items-center gap-2.5 rounded-[3px] border px-3 py-2 text-left text-sm transition-colors',
                selected
                  ? 'border-forest bg-white text-forest'
                  : 'border-[#E8ECEF] bg-white text-charcoal hover:border-sage/40',
                readOnly && 'cursor-default opacity-70'
              )}
            >
              <div
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                  selected ? 'border-forest' : 'border-mid/40'
                )}
              >
                {selected && <div className="size-2 rounded-full bg-forest" />}
              </div>
              <span>{option}</span>
            </button>
          )
        })}
      </div>
    </QuestionWrapper>
  )
}

// ─── Checkbox ──────────────────────────────────────────────────────

interface CheckboxQuestionProps {
  question: EvaluationQuestion
  value: string[] | undefined
  onChange: (value: string[]) => void
  readOnly?: boolean
}

export function CheckboxQuestion({ question, value = [], onChange, readOnly }: CheckboxQuestionProps) {
  function toggle(option: string) {
    if (readOnly) return
    if (value.includes(option)) {
      onChange(value.filter((v) => v !== option))
    } else {
      onChange([...value, option])
    }
  }

  return (
    <QuestionWrapper question={question}>
      <div className="flex flex-col gap-1.5">
        {question.options?.map((option) => {
          const checked = value.includes(option)
          return (
            <button
              key={option}
              type="button"
              disabled={readOnly}
              onClick={() => toggle(option)}
              className={cn(
                'flex items-center gap-2.5 rounded-[3px] border px-3 py-2 text-left text-sm transition-colors',
                checked
                  ? 'border-forest bg-white text-forest'
                  : 'border-[#E8ECEF] bg-white text-charcoal hover:border-sage/40',
                readOnly && 'cursor-default opacity-70'
              )}
            >
              <Checkbox
                checked={checked}
                disabled={readOnly}
                className={cn(
                  checked && 'border-forest bg-forest text-white'
                )}
                tabIndex={-1}
              />
              <span>{option}</span>
            </button>
          )
        })}
      </div>
    </QuestionWrapper>
  )
}

// ─── Scale ─────────────────────────────────────────────────────────

interface ScaleQuestionProps {
  question: EvaluationQuestion
  value: number | undefined
  onChange: (value: number) => void
  readOnly?: boolean
}

export function ScaleQuestion({ question, value, onChange, readOnly }: ScaleQuestionProps) {
  const min = question.scaleMin ?? 1
  const max = question.scaleMax ?? 5
  const range = Array.from({ length: max - min + 1 }, (_, i) => min + i)

  return (
    <QuestionWrapper question={question}>
      <div className="flex flex-col gap-1">
        <div className="flex gap-1.5">
          {range.map((n) => {
            const selected = value === n
            return (
              <button
                key={n}
                type="button"
                disabled={readOnly}
                onClick={() => onChange(n)}
                className={cn(
                  'flex size-10 items-center justify-center rounded-[3px] border text-sm font-medium transition-colors',
                  selected
                    ? 'border-forest bg-forest text-cream'
                    : 'border-[#E8ECEF] bg-white text-charcoal hover:border-sage/40',
                  readOnly && 'cursor-default opacity-70'
                )}
              >
                {n}
              </button>
            )
          })}
        </div>
        {(question.scaleMinLabel || question.scaleMaxLabel) && (
          <div className="flex justify-between px-1">
            <span className="text-[11px] text-mid">{question.scaleMinLabel ?? ''}</span>
            <span className="text-[11px] text-mid">{question.scaleMaxLabel ?? ''}</span>
          </div>
        )}
      </div>
    </QuestionWrapper>
  )
}

// ─── Text ──────────────────────────────────────────────────────────

interface TextQuestionProps {
  question: EvaluationQuestion
  value: string | undefined
  onChange: (value: string) => void
  readOnly?: boolean
}

export function TextQuestion({ question, value, onChange, readOnly }: TextQuestionProps) {
  return (
    <QuestionWrapper question={question}>
      <Textarea
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        placeholder="Digite sua resposta..."
        className="min-h-[80px] rounded-[3px] border-[#E8ECEF] bg-white text-sm"
      />
    </QuestionWrapper>
  )
}

// ─── Checkbox with Other ───────────────────────────────────────────

interface CheckboxWithOtherQuestionProps {
  question: EvaluationQuestion
  value: { selected: string[]; other: string } | undefined
  onChange: (value: { selected: string[]; other: string }) => void
  readOnly?: boolean
}

export function CheckboxWithOtherQuestion({
  question,
  value = { selected: [], other: '' },
  onChange,
  readOnly,
}: CheckboxWithOtherQuestionProps) {
  function toggle(option: string) {
    if (readOnly) return
    const selected = value.selected.includes(option)
      ? value.selected.filter((v) => v !== option)
      : [...value.selected, option]
    onChange({ ...value, selected })
  }

  return (
    <QuestionWrapper question={question}>
      <div className="flex flex-col gap-1.5">
        {question.options?.map((option) => {
          const checked = value.selected.includes(option)
          return (
            <button
              key={option}
              type="button"
              disabled={readOnly}
              onClick={() => toggle(option)}
              className={cn(
                'flex items-center gap-2.5 rounded-[3px] border px-3 py-2 text-left text-sm transition-colors',
                checked
                  ? 'border-forest bg-white text-forest'
                  : 'border-[#E8ECEF] bg-white text-charcoal hover:border-sage/40',
                readOnly && 'cursor-default opacity-70'
              )}
            >
              <Checkbox
                checked={checked}
                disabled={readOnly}
                className={cn(checked && 'border-forest bg-forest text-white')}
                tabIndex={-1}
              />
              <span>{option}</span>
            </button>
          )
        })}

        {/* "Outra:" text input */}
        <div className="flex items-center gap-2 pt-1">
          <span className="text-sm text-mid">Outra:</span>
          <Input
            value={value.other}
            onChange={(e) => onChange({ ...value, other: e.target.value })}
            readOnly={readOnly}
            placeholder="Especifique..."
            className="h-8 flex-1 rounded-[3px] border-[#E8ECEF] text-sm"
          />
        </div>
      </div>
    </QuestionWrapper>
  )
}

// ─── Radio with Other ──────────────────────────────────────────────

interface RadioWithOtherQuestionProps {
  question: EvaluationQuestion
  value: { selected: string; other: string } | undefined
  onChange: (value: { selected: string; other: string }) => void
  readOnly?: boolean
}

export function RadioWithOtherQuestion({
  question,
  value = { selected: '', other: '' },
  onChange,
  readOnly,
}: RadioWithOtherQuestionProps) {
  return (
    <QuestionWrapper question={question}>
      <div className="flex flex-col gap-1.5">
        {question.options?.map((option) => {
          const selected = value.selected === option
          return (
            <button
              key={option}
              type="button"
              disabled={readOnly}
              onClick={() => onChange({ ...value, selected: option })}
              className={cn(
                'flex items-center gap-2.5 rounded-[3px] border px-3 py-2 text-left text-sm transition-colors',
                selected
                  ? 'border-forest bg-white text-forest'
                  : 'border-[#E8ECEF] bg-white text-charcoal hover:border-sage/40',
                readOnly && 'cursor-default opacity-70'
              )}
            >
              <div
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                  selected ? 'border-forest' : 'border-mid/40'
                )}
              >
                {selected && <div className="size-2 rounded-full bg-forest" />}
              </div>
              <span>{option}</span>
            </button>
          )
        })}

        {/* "Outra:" text input */}
        <div className="flex items-center gap-2 pt-1">
          <span className="text-sm text-mid">Outra:</span>
          <Input
            value={value.other}
            onChange={(e) => onChange({ ...value, other: e.target.value })}
            readOnly={readOnly}
            placeholder="Especifique..."
            className="h-8 flex-1 rounded-[3px] border-[#E8ECEF] text-sm"
          />
        </div>
      </div>
    </QuestionWrapper>
  )
}

// ─── Face Diagram ──────────────────────────────────────────────────

interface FaceDiagramQuestionProps {
  question: EvaluationQuestion
  diagramRendered?: boolean
  diagramPoints?: DiagramPointData[]
  onDiagramChange?: (points: DiagramPointData[]) => void
  patientGender?: string | null
  products?: CatalogProduct[]
  readOnly?: boolean
}

export function FaceDiagramQuestion({
  question,
  diagramRendered,
  diagramPoints = [],
  onDiagramChange,
  patientGender,
  products,
  readOnly,
}: FaceDiagramQuestionProps) {
  return (
    <QuestionWrapper question={question}>
      {diagramRendered ? (
        <div className="flex items-center gap-2 rounded-[3px] bg-sage/10 px-3 py-2.5">
          <span className="text-sm text-sage">
            Diagrama facial preenchido acima
          </span>
        </div>
      ) : (
        <FaceDiagramEditor
          points={diagramPoints}
          onChange={onDiagramChange ?? (() => {})}
          readOnly={readOnly}
          gender={patientGender}
          products={products}
        />
      )}
    </QuestionWrapper>
  )
}
