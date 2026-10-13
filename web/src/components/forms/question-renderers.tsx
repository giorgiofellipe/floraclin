'use client'

import * as React from 'react'
import { AlertTriangle, PlusIcon, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { isQuestionAnswered } from '@/lib/forms/answers'
import type { FormQuestion } from '@/lib/forms/types'

// ─── Shared wrapper ────────────────────────────────────────────────

interface QuestionWrapperProps {
  question: FormQuestion
  children: React.ReactNode
  hasError?: boolean
}

export function QuestionWrapper({ question, children, hasError }: QuestionWrapperProps) {
  return (
    <div
      aria-invalid={hasError || undefined}
      className={cn(
        'flex flex-col gap-2 rounded-[3px] p-2 -m-2 transition-colors',
        hasError && 'border border-red-200 bg-red-50',
      )}
    >
      <div className="flex flex-col gap-0.5">
        <Label
          className={cn(
            'text-sm font-medium',
            hasError ? 'text-red-700' : 'text-charcoal',
          )}
        >
          {question.label}
          {question.required && (
            <span className={cn('ml-0.5', hasError ? 'text-red-600' : 'text-amber')}>*</span>
          )}
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

      {hasError && (
        <p className="text-xs text-red-600 font-medium">Campo obrigatório</p>
      )}
    </div>
  )
}

// ─── Radio ─────────────────────────────────────────────────────────

interface RadioQuestionProps {
  question: FormQuestion
  value: string | undefined
  onChange: (value: string) => void
  readOnly?: boolean
  showErrors?: boolean
}

export function RadioQuestion({ question, value, onChange, readOnly, showErrors }: RadioQuestionProps) {
  const hasError = showErrors && question.required && (!value || value.length === 0)
  return (
    <QuestionWrapper question={question} hasError={hasError}>
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
  question: FormQuestion
  value: string[] | undefined
  onChange: (value: string[]) => void
  readOnly?: boolean
  showErrors?: boolean
}

export function CheckboxQuestion({ question, value = [], onChange, readOnly, showErrors }: CheckboxQuestionProps) {
  function toggle(option: string) {
    if (readOnly) return
    if (value.includes(option)) {
      onChange(value.filter((v) => v !== option))
    } else {
      onChange([...value, option])
    }
  }

  const hasError = showErrors && question.required && value.length === 0
  return (
    <QuestionWrapper question={question} hasError={hasError}>
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
  question: FormQuestion
  value: number | undefined
  onChange: (value: number) => void
  readOnly?: boolean
  showErrors?: boolean
}

export function ScaleQuestion({ question, value, onChange, readOnly, showErrors }: ScaleQuestionProps) {
  const min = question.scaleMin ?? 1
  const max = question.scaleMax ?? 5
  const range = Array.from({ length: max - min + 1 }, (_, i) => min + i)

  const hasError = showErrors && question.required && value === undefined
  return (
    <QuestionWrapper question={question} hasError={hasError}>
      <div className="flex flex-wrap items-center gap-2">
        {question.scaleMinLabel && (
          <span className="text-[11px] text-mid whitespace-nowrap">{question.scaleMinLabel}</span>
        )}
        <div className="flex flex-wrap gap-1.5">
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
        {question.scaleMaxLabel && (
          <span className="text-[11px] text-mid whitespace-nowrap">{question.scaleMaxLabel}</span>
        )}
      </div>
    </QuestionWrapper>
  )
}

// ─── Text ──────────────────────────────────────────────────────────

interface TextQuestionProps {
  question: FormQuestion
  value: string | undefined
  onChange: (value: string) => void
  readOnly?: boolean
  showErrors?: boolean
}

export function TextQuestion({ question, value, onChange, readOnly, showErrors }: TextQuestionProps) {
  const hasError = showErrors && question.required && (!value || value.trim().length === 0)
  return (
    <QuestionWrapper question={question} hasError={hasError}>
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
  question: FormQuestion
  value: { selected: string[]; other: string } | undefined
  onChange: (value: { selected: string[]; other: string }) => void
  readOnly?: boolean
  showErrors?: boolean
}

export function CheckboxWithOtherQuestion({
  question,
  value = { selected: [], other: '' },
  onChange,
  readOnly,
  showErrors,
}: CheckboxWithOtherQuestionProps) {
  function toggle(option: string) {
    if (readOnly) return
    const selected = value.selected.includes(option)
      ? value.selected.filter((v) => v !== option)
      : [...value.selected, option]
    onChange({ ...value, selected })
  }

  const hasError = showErrors && question.required && value.selected.length === 0 && (!value.other || value.other.trim().length === 0)
  return (
    <QuestionWrapper question={question} hasError={hasError}>
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
  question: FormQuestion
  value: { selected: string; other: string } | undefined
  onChange: (value: { selected: string; other: string }) => void
  readOnly?: boolean
  showErrors?: boolean
}

export function RadioWithOtherQuestion({
  question,
  value = { selected: '', other: '' },
  onChange,
  readOnly,
  showErrors,
}: RadioWithOtherQuestionProps) {
  const hasError = showErrors && question.required && (!value.selected || value.selected.length === 0) && (!value.other || value.other.trim().length === 0)
  return (
    <QuestionWrapper question={question} hasError={hasError}>
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

// ─── List ──────────────────────────────────────────────────────────

interface ListQuestionProps {
  question: FormQuestion
  value: Record<string, string>[] | undefined
  onChange: (value: Record<string, string>[]) => void
  readOnly?: boolean
  showErrors?: boolean
}

export function ListQuestion({ question, value = [], onChange, readOnly, showErrors }: ListQuestionProps) {
  const columns = question.columns ?? []
  const hasError = showErrors && question.required && !isQuestionAnswered(question, value)

  function setCell(rowIndex: number, columnId: string, cell: string | null) {
    onChange(
      value.map((row, i) => {
        if (i !== rowIndex) return row
        if (cell === null || cell === '') {
          const { [columnId]: _removed, ...rest } = row
          return rest
        }
        return { ...row, [columnId]: cell }
      }),
    )
  }

  return (
    <QuestionWrapper question={question} hasError={hasError}>
      <div className="flex flex-col gap-2">
        {value.length > 0 && (
          <div
            className="hidden gap-2 text-xs font-medium text-mid sm:flex"
            aria-hidden="true"
          >
            {columns.map((column) => (
              <span key={column.id} className="flex-1">
                {column.label}
                {column.required && <span className="ml-0.5 text-amber">*</span>}
              </span>
            ))}
            {!readOnly && <span className="size-8 shrink-0" />}
          </div>
        )}
        {value.map((row, rowIndex) => {
          // Rows with every cell blank are dropped on save, so only partly filled rows need their required cells.
          const rowStarted = Object.values(row).some((cell) => cell.trim() !== '')
          return (
            <div
              key={rowIndex}
              className="flex flex-col gap-2 rounded-[3px] border border-topbar-border bg-white p-3 sm:flex-row sm:items-start sm:border-0 sm:bg-transparent sm:p-0"
            >
              <div className={cn('flex items-center justify-between sm:order-last', readOnly && 'sm:hidden')}>
                <span className="text-xs font-medium text-mid sm:hidden">Item {rowIndex + 1}</span>
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remover item ${rowIndex + 1}`}
                    onClick={() => onChange(value.filter((_, i) => i !== rowIndex))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
              {columns.map((column) => {
                const cellError =
                  showErrors && column.required && rowStarted && (row[column.id] ?? '').trim() === ''
                return (
                  <div key={column.id} className="flex flex-1 flex-col gap-1">
                    <span className="text-xs font-medium text-mid sm:hidden" aria-hidden="true">
                      {column.label}
                      {column.required && <span className="ml-0.5 text-amber">*</span>}
                    </span>
                    {column.kind === 'select' ? (
                      <Select
                        items={Object.fromEntries((column.options ?? []).map((o) => [o, o]))}
                        value={row[column.id] ?? null}
                        onValueChange={(v) => setCell(rowIndex, column.id, v as string | null)}
                        disabled={readOnly}
                      >
                        <SelectTrigger className="w-full" aria-label={column.label} aria-invalid={cellError || undefined}>
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                        <SelectContent />
                      </Select>
                    ) : (
                      <Input
                        value={row[column.id] ?? ''}
                        onChange={(e) => setCell(rowIndex, column.id, e.target.value)}
                        readOnly={readOnly}
                        disabled={readOnly}
                        placeholder={column.label}
                        aria-label={column.label}
                        aria-invalid={cellError || undefined}
                        className="h-8 rounded-[3px] border-topbar-border text-sm"
                      />
                    )}
                    {cellError && <p className="text-xs font-medium text-red-600">Preencha este campo</p>}
                  </div>
                )
              })}
            </div>
          )
        })}
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => onChange([...value, {}])}
          >
            <PlusIcon data-icon="inline-start" />
            Adicionar item
          </Button>
        )}
      </div>
    </QuestionWrapper>
  )
}
