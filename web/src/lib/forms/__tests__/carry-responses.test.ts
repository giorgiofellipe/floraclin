import { describe, it, expect } from 'vitest'
import { carryResponses } from '../carry-responses'
import type { FormQuestion, FormSection } from '../types'

const sectionOf = (...questions: FormQuestion[]): FormSection[] => [{ id: 's', title: 'S', order: 0, questions }]
const text: FormQuestion = { id: 'a', label: 'A', type: 'text', required: false, order: 0 }
const choice = (type: FormQuestion['type'], options: string[]): FormQuestion => ({
  id: 'a', label: 'A', type, required: false, order: 0, options,
})
const allergies = (severityOptions: string[]): FormQuestion => ({
  id: 'a', label: 'Alergias', type: 'list', required: false, order: 0,
  columns: [
    { id: 'name', label: 'Nome', kind: 'text', required: true },
    { id: 'severity', label: 'Gravidade', kind: 'select', options: severityOptions },
  ],
})

describe('carryResponses', () => {
  it('drops answers whose question id no longer exists', () => {
    expect(carryResponses({ a: 'x', gone: 'y' }, sectionOf(text))).toEqual({ a: 'x' })
  })

  it('keeps an answer when only the question label was reworded', () => {
    expect(carryResponses({ a: 'x' }, sectionOf({ ...text, label: 'Novo texto' }))).toEqual({ a: 'x' })
  })

  it('does not carry an inherited Object property as an answer', () => {
    const diagram: FormQuestion = { id: 'constructor', label: 'D', type: 'face_diagram', required: false, order: 0 }
    expect(carryResponses({}, sectionOf(diagram))).toEqual({})
  })

  // Regression: one invalid part (a renamed option, an unknown column) dropped the whole answer,
  // so renaming "Grave" erased every allergy the patient listed.
  it.each<[string, FormQuestion, unknown, unknown]>([
    ['type change drops the answer', choice('checkbox', ['x', 'y']), 'x', undefined],
    ['renamed radio option drops the selection', choice('radio', ['Positivo', 'Não']), 'Sim', undefined],
    ['checkbox keeps the options that still exist', choice('checkbox', ['A', 'C']), ['A', 'B', 'C'], ['A', 'C']],
    [
      'checkbox_with_other keeps existing options and other',
      choice('checkbox_with_other', ['A']),
      { selected: ['A', 'B'], other: 'Outra' },
      { selected: ['A'], other: 'Outra' },
    ],
    [
      'radio_with_other clears a removed option and keeps other',
      choice('radio_with_other', ['A', 'C']),
      { selected: 'B', other: 'Outra' },
      { selected: '', other: 'Outra' },
    ],
    [
      'rename of "Grave" keeps every allergy row and drops only that cell',
      allergies(['Leve', 'Severa']),
      [{ name: 'Dipirona', severity: 'Grave' }, { name: 'Látex', severity: 'Leve' }],
      [{ name: 'Dipirona' }, { name: 'Látex', severity: 'Leve' }],
    ],
    [
      'list drops unknown columns and rows left empty',
      allergies(['Leve', 'Grave']),
      [{ name: 'Dipirona', removed: 'x' }, { removed: 'y' }, { severity: 'Moderada' }],
      [{ name: 'Dipirona' }],
    ],
    [
      'list keeps a row missing a required cell (required is not enforced on carry)',
      allergies(['Leve', 'Grave']),
      [{ severity: 'Leve' }],
      [{ severity: 'Leve' }],
    ],
    [
      'scale drops a value outside the new range',
      { ...text, type: 'scale', scaleMin: 1, scaleMax: 5 },
      8,
      undefined,
    ],
  ])('%s', (_name, question, value, expected) => {
    const carried = carryResponses({ a: value }, sectionOf(question))
    expect(carried).toEqual(expected === undefined ? {} : { a: expected })
  })
})
