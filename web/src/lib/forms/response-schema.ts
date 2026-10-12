import { z } from 'zod'
import { isQuestionAnswered } from './answers'
import { FORM_LIMITS } from './constants'
import type { FormQuestion, FormSection } from './types'

const isBlank = (v: string | undefined) => v === undefined || v.trim() === ''

function freeText(label: string) {
  return z.string().max(FORM_LIMITS.textLength, `${label}: no máximo ${FORM_LIMITS.textLength} caracteres`)
}

function member(question: FormQuestion) {
  const options = question.options ?? []
  return z.string().refine((v) => options.includes(v), { message: `${question.label}: opção inválida` })
}

function scaleSchema(question: FormQuestion) {
  let schema = z.number().int(`${question.label}: valor inválido`)
  if (question.scaleMin !== undefined) schema = schema.min(question.scaleMin, `${question.label}: valor fora da escala`)
  if (question.scaleMax !== undefined) schema = schema.max(question.scaleMax, `${question.label}: valor fora da escala`)
  return schema
}

function selections(question: FormQuestion) {
  return z
    .array(member(question))
    .refine((v) => new Set(v).size === v.length, { message: `${question.label}: opção repetida` })
}

function listSchema(question: FormQuestion, enforceRequired: boolean) {
  const columns = question.columns ?? []
  return z
    .array(z.record(z.string(), freeText(question.label)))
    .max(FORM_LIMITS.listRows, `${question.label}: no máximo ${FORM_LIMITS.listRows} linhas`)
    .transform((rows) =>
      rows
        .map((row) => Object.fromEntries(columns.filter((c) => !isBlank(row[c.id])).map((c) => [c.id, row[c.id]])))
        .filter((row) => Object.keys(row).length > 0),
    )
    .superRefine((rows, ctx) => {
      rows.forEach((row, index) => {
        for (const column of columns) {
          const value = row[column.id]
          if (enforceRequired && column.required && value === undefined) {
            ctx.addIssue({ code: 'custom', message: `${column.label}: campo obrigatório`, path: [index, column.id] })
          }
          if (column.kind === 'select' && value !== undefined && !(column.options ?? []).includes(value)) {
            ctx.addIssue({ code: 'custom', message: `${column.label}: opção inválida`, path: [index, column.id] })
          }
        }
      })
    })
}

function shapeSchema(question: FormQuestion, enforceRequired: boolean): z.ZodTypeAny {
  switch (question.type) {
    case 'radio':
      return member(question)
    case 'text':
      return freeText(question.label)
    case 'scale':
      return scaleSchema(question)
    case 'checkbox':
      return selections(question)
    case 'checkbox_with_other':
      return z.object({ selected: selections(question).default([]), other: freeText(question.label).default('') })
    case 'radio_with_other':
      return z.object({ selected: z.literal('').or(member(question)).default(''), other: freeText(question.label).default('') })
    case 'list':
      return listSchema(question, enforceRequired)
    case 'face_diagram':
      return z.unknown()
  }
}

export function questionResponseSchema(question: FormQuestion, options: { enforceRequired: boolean }): z.ZodTypeAny {
  const shape = shapeSchema(question, options.enforceRequired)
  if (!(options.enforceRequired && question.required)) return shape.optional()
  return z
    .unknown()
    .refine((v) => isQuestionAnswered(question, v), { message: `${question.label}: campo obrigatório` })
    .pipe(shape)
}

export function buildFormResponseSchema(sections: FormSection[], options: { enforceRequired: boolean }) {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const section of sections ?? []) {
    for (const question of section.questions ?? []) shape[question.id] = questionResponseSchema(question, options)
  }
  return z.object(shape)
}
