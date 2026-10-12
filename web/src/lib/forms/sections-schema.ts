import { z } from 'zod'
import { CHOICE_QUESTION_TYPES, DEFAULT_SCALE_MAX, DEFAULT_SCALE_MIN, FORM_LIMITS } from './constants'
import { BASE_QUESTION_TYPES } from './types'

const label = z
  .string()
  .trim()
  .min(1, 'Preencha todos os títulos e rótulos')
  .max(FORM_LIMITS.labelLength, `Títulos e rótulos podem ter no máximo ${FORM_LIMITS.labelLength} caracteres`)
const optionalLabel = z
  .string()
  .max(FORM_LIMITS.labelLength, `Rótulos podem ter no máximo ${FORM_LIMITS.labelLength} caracteres`)
  .optional()
const longText = z
  .string()
  .max(FORM_LIMITS.textLength, `Textos de ajuda podem ter no máximo ${FORM_LIMITS.textLength} caracteres`)
  .optional()

// Ids become object keys in responses; these would hit Object.prototype.
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype'])
const formId = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, 'Identificador inválido: use apenas letras, números, "-" ou "_"')
  .refine((id) => !RESERVED_IDS.has(id), 'Identificador reservado, escolha outro')

const options = z
  .array(label)
  .max(FORM_LIMITS.options, `Cada pergunta ou coluna pode ter no máximo ${FORM_LIMITS.options} opções`)
  .refine((o) => new Set(o).size === o.length, 'Opções repetidas não são permitidas')
  .optional()

export const formListColumnSchema = z
  .object({
    id: formId,
    label,
    kind: z.enum(['text', 'select']),
    options,
    required: z.boolean().optional(),
  })
  .refine((c) => c.kind !== 'select' || (c.options?.length ?? 0) >= 2, {
    message: 'Colunas de seleção precisam de ao menos 2 opções',
    path: ['options'],
  })

export const formQuestionSchema = z
  .object({
    id: formId,
    label,
    type: z.enum([...BASE_QUESTION_TYPES, 'face_diagram']),
    required: z.boolean(),
    order: z.number().int(),
    options,
    scaleMin: z.number().int('O mínimo da escala deve ser um número inteiro').optional(),
    scaleMax: z.number().int('O máximo da escala deve ser um número inteiro').optional(),
    scaleMinLabel: optionalLabel,
    scaleMaxLabel: optionalLabel,
    helpText: longText,
    warningText: longText,
    columns: z
      .array(formListColumnSchema)
      .max(FORM_LIMITS.listColumns, `Listas podem ter no máximo ${FORM_LIMITS.listColumns} colunas`)
      .optional(),
  })
  .superRefine((q, ctx) => {
    if (CHOICE_QUESTION_TYPES.includes(q.type) && (q.options?.length ?? 0) < 2) {
      ctx.addIssue({ code: 'custom', message: `"${q.label}" precisa de ao menos 2 opções`, path: ['options'] })
    }
    if (q.type === 'scale') {
      const min = q.scaleMin ?? DEFAULT_SCALE_MIN
      const max = q.scaleMax ?? DEFAULT_SCALE_MAX
      if (min > max) {
        ctx.addIssue({
          code: 'custom',
          message: `"${q.label}": o mínimo da escala não pode ser maior que o máximo`,
          path: ['scaleMin'],
        })
      } else if (max - min > FORM_LIMITS.scaleSpan) {
        ctx.addIssue({
          code: 'custom',
          message: `"${q.label}": a escala pode ter no máximo ${FORM_LIMITS.scaleSpan + 1} valores`,
          path: ['scaleMax'],
        })
      }
    }
    if (q.type === 'list') {
      const columns = q.columns ?? []
      if (columns.length === 0) {
        ctx.addIssue({ code: 'custom', message: `"${q.label}" precisa de ao menos 1 coluna`, path: ['columns'] })
      }
      if (new Set(columns.map((c) => c.id)).size !== columns.length) {
        ctx.addIssue({ code: 'custom', message: `"${q.label}" tem colunas repetidas`, path: ['columns'] })
      }
    }
  })

export const formSectionsSchema = z
  .array(
    z.object({
      id: formId,
      title: label,
      order: z.number().int(),
      questions: z
        .array(formQuestionSchema)
        .max(
          FORM_LIMITS.questionsPerSection,
          `Cada seção pode ter no máximo ${FORM_LIMITS.questionsPerSection} perguntas`,
        ),
    }),
  )
  .max(FORM_LIMITS.sections, `O modelo pode ter no máximo ${FORM_LIMITS.sections} seções`)
  .superRefine((sections, ctx) => {
    const sectionIds = new Set<string>()
    const questionIds = new Set<string>()
    for (const section of sections) {
      if (sectionIds.has(section.id)) ctx.addIssue({ code: 'custom', message: 'Seções com identificador repetido' })
      sectionIds.add(section.id)
      for (const question of section.questions) {
        if (questionIds.has(question.id)) ctx.addIssue({ code: 'custom', message: 'Perguntas com identificador repetido' })
        questionIds.add(question.id)
      }
    }
  })
