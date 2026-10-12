import { describe, it, expect } from 'vitest'
import { formSectionsSchema } from '../sections-schema'
import { FORM_LIMITS } from '../constants'
import type { FormSection } from '../types'

const q = (id: string, extra: Record<string, unknown> = {}) => ({
  id, label: `Pergunta ${id}`, type: 'text', required: false, order: 0, ...extra,
})

function fixture(): FormSection[] {
  return [
    { id: 's1', title: 'Um', order: 0, questions: [q('q1'), q('q2', { type: 'radio', options: ['A', 'B'] })] },
    { id: 's2', title: 'Dois', order: 1, questions: [q('q3')] },
  ] as FormSection[]
}

describe('formSectionsSchema', () => {
  it('accepts a well-formed template', () => {
    expect(formSectionsSchema.safeParse(fixture()).success).toBe(true)
  })

  const rows: [string, (s: FormSection[]) => void][] = [
    ['duplicate question id across sections lets one answer overwrite another', (s) => { s[1].questions[0].id = 'q1' }],
    ['duplicate section id', (s) => { s[1].id = 's1' }],
    ['radio with a single option offers no real choice', (s) => { s[0].questions[1].options = ['A'] }],
    ['list with no columns cannot store answers', (s) => { s[0].questions[0] = q('l', { type: 'list', columns: [] }) as never }],
    ['list with duplicate column ids collapses cells', (s) => {
      s[0].questions[0] = q('l', { type: 'list', columns: [
        { id: 'c', label: 'A', kind: 'text' }, { id: 'c', label: 'B', kind: 'text' },
      ] }) as never
    }],
    ['select column with a single option', (s) => {
      s[0].questions[0] = q('l', { type: 'list', columns: [{ id: 'c', label: 'A', kind: 'select', options: ['x'] }] }) as never
    }],
    ['blank question label', (s) => { s[0].questions[0].label = '   ' }],
    ['question id with a dot breaks dotted form paths', (s) => { s[0].questions[0].id = 'a.b' }],
    ['section id with a space', (s) => { s[0].id = 's 1' }],
    ['list column id with a slash', (s) => {
      s[0].questions[0] = q('l', { type: 'list', columns: [{ id: 'c/1', label: 'A', kind: 'text' }] }) as never
    }],
    ['scale whose minimum is above its maximum has no valid answer', (s) => {
      s[0].questions[0] = q('sc', { type: 'scale', scaleMin: 10, scaleMax: 0 }) as never
    }],
  ]

  const chars = (n: number) => 'a'.repeat(n)
  const optionList = (n: number) => Array.from({ length: n }, (_, i) => `Opção ${i}`)
  const questions = (n: number) => Array.from({ length: n }, (_, i) => q(`m${i}`)) as never
  const textColumns = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, label: `C${i}`, kind: 'text' }))
  const scale = (scaleMin: number, scaleMax: number) => q('sc', { type: 'scale', scaleMin, scaleMax }) as never
  const selectColumn = (options: string[]) => q('l', { type: 'list', columns: [{ id: 'c', label: 'A', kind: 'select', options }] }) as never
  const manySections = (n: number) => (s: FormSection[]) => {
    s.push(...Array.from({ length: n - s.length }, (_, i) => ({ id: `extra${i}`, title: 'T', order: i, questions: [] })))
  }

  // Unbounded templates are stored in jsonb and rendered for every patient; each limit has a boundary row.
  const limits: [string, (s: FormSection[]) => void, boolean][] = [
    ['label at the length limit', (s) => { s[0].questions[0].label = chars(FORM_LIMITS.labelLength) }, true],
    ['label over the length limit', (s) => { s[0].questions[0].label = chars(FORM_LIMITS.labelLength + 1) }, false],
    ['section title over the length limit', (s) => { s[0].title = chars(FORM_LIMITS.labelLength + 1) }, false],
    ['option text over the length limit', (s) => { s[0].questions[1].options = ['A', chars(FORM_LIMITS.labelLength + 1)] }, false],
    ['help text over the length limit', (s) => { s[0].questions[0].helpText = chars(FORM_LIMITS.textLength + 1) }, false],
    ['sections at the limit', manySections(FORM_LIMITS.sections), true],
    ['sections over the limit', manySections(FORM_LIMITS.sections + 1), false],
    ['questions per section at the limit', (s) => { s[1].questions = questions(FORM_LIMITS.questionsPerSection) }, true],
    ['questions per section over the limit', (s) => { s[1].questions = questions(FORM_LIMITS.questionsPerSection + 1) }, false],
    ['options at the limit', (s) => { s[0].questions[1].options = optionList(FORM_LIMITS.options) }, true],
    ['options over the limit', (s) => { s[0].questions[1].options = optionList(FORM_LIMITS.options + 1) }, false],
    ['select column options over the limit', (s) => { s[0].questions[0] = selectColumn(optionList(FORM_LIMITS.options + 1)) }, false],
    ['duplicate question options', (s) => { s[0].questions[1].options = ['A', 'B', 'A'] }, false],
    ['duplicate select column options', (s) => { s[0].questions[0] = selectColumn(['x', 'y', 'x']) }, false],
    ['list columns at the limit', (s) => { s[0].questions[0] = q('l', { type: 'list', columns: textColumns(FORM_LIMITS.listColumns) }) as never }, true],
    ['list columns over the limit', (s) => { s[0].questions[0] = q('l', { type: 'list', columns: textColumns(FORM_LIMITS.listColumns + 1) }) as never }, false],
    ['scale span at the limit', (s) => { s[0].questions[0] = scale(0, FORM_LIMITS.scaleSpan) }, true],
    ['scale span over the limit', (s) => { s[0].questions[0] = scale(0, FORM_LIMITS.scaleSpan + 1) }, false],
    ['scale over the limit through the default minimum', (s) => {
      s[0].questions[0] = q('sc', { type: 'scale', scaleMax: 1000 }) as never
    }, false],
    ['fractional scale bound', (s) => { s[0].questions[0] = scale(0.5, 5) }, false],
    ...['__proto__', 'constructor', 'prototype'].map((id): [string, (s: FormSection[]) => void, boolean] =>
      [`reserved question id ${id}`, (s) => { s[0].questions[0].id = id }, false]),
  ]

  it.each(limits)('%s', (_name, mutate, valid) => {
    const s = fixture()
    mutate(s)
    expect(formSectionsSchema.safeParse(s).success).toBe(valid)
  })

  it.each(rows)('rejects %s', (_name, mutate) => {
    const s = fixture()
    mutate(s)
    expect(formSectionsSchema.safeParse(s).success).toBe(false)
  })
})
