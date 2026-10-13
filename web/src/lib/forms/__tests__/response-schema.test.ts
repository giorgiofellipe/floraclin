import { describe, it, expect } from 'vitest'
import { buildFormResponseSchema } from '../response-schema'
import { FORM_LIMITS } from '../constants'
import type { FormQuestion, FormSection } from '../types'

const base = { required: false, order: 0 }
function sectionOf(...questions: FormQuestion[]): FormSection[] {
  return [{ id: 's', title: 'S', order: 0, questions }]
}

const list: FormQuestion = {
  ...base, id: 'meds', label: 'Medicamentos', type: 'list',
  columns: [
    { id: 'name', label: 'Nome', kind: 'text', required: true },
    { id: 'severity', label: 'Gravidade', kind: 'select', options: ['Leve', 'Grave'] },
  ],
}

describe('buildFormResponseSchema', () => {
  it('drops blank list rows so empty rows are not persisted', () => {
    const r = buildFormResponseSchema(sectionOf(list), { enforceRequired: true }).parse({
      meds: [{ name: 'A', severity: 'Leve' }, { name: ' ', severity: '' }],
    })
    expect(r.meds).toEqual([{ name: 'A', severity: 'Leve' }])
  })

  it('enforces required list columns only when enforceRequired is on', () => {
    const input = { meds: [{ severity: 'Leve' }] }
    expect(buildFormResponseSchema(sectionOf(list), { enforceRequired: true }).safeParse(input).success).toBe(false)
    expect(buildFormResponseSchema(sectionOf(list), { enforceRequired: false }).safeParse(input).success).toBe(true)
  })

  it('rejects a select cell outside the column options in both modes', () => {
    const input = { meds: [{ name: 'A', severity: 'Média' }] }
    for (const enforceRequired of [true, false]) {
      expect(buildFormResponseSchema(sectionOf(list), { enforceRequired }).safeParse(input).success).toBe(false)
    }
  })

  it('rejects radio and checkbox values that are not current options', () => {
    const radio: FormQuestion = { ...base, id: 'r', label: 'R', type: 'radio', options: ['Sim', 'Não'] }
    const check: FormQuestion = { ...base, id: 'c', label: 'C', type: 'checkbox', options: ['A', 'B'] }
    const schema = buildFormResponseSchema(sectionOf(radio, check), { enforceRequired: false })
    expect(schema.safeParse({ r: 'Talvez' }).success).toBe(false)
    expect(schema.safeParse({ c: ['A', 'Z'] }).success).toBe(false)
    expect(schema.safeParse({ r: 'Sim', c: ['A'] }).success).toBe(true)
  })

  it.each([
    ['scale value above scaleMax', 11],
    ['scale value below scaleMin', 0],
    ['fractional scale value', 2.5],
  ])('rejects a %s', (_name, value) => {
    const scale: FormQuestion = { ...base, id: 'sc', label: 'Dor', type: 'scale', scaleMin: 1, scaleMax: 10 }
    const schema = buildFormResponseSchema(sectionOf(scale), { enforceRequired: false })
    expect(schema.safeParse({ sc: value }).success).toBe(false)
    expect(schema.safeParse({ sc: 10 }).success).toBe(true)
  })

  it('rejects the same option selected twice in checkbox and checkbox_with_other', () => {
    const check: FormQuestion = { ...base, id: 'c', label: 'C', type: 'checkbox', options: ['A', 'B'] }
    const other: FormQuestion = { ...base, id: 'w', label: 'W', type: 'checkbox_with_other', options: ['A', 'B'] }
    const schema = buildFormResponseSchema(sectionOf(check, other), { enforceRequired: false })
    expect(schema.safeParse({ c: ['A', 'A'] }).success).toBe(false)
    expect(schema.safeParse({ w: { selected: ['B', 'B'], other: '' } }).success).toBe(false)
    expect(schema.safeParse({ c: ['A', 'B'], w: { selected: ['B'], other: '' } }).success).toBe(true)
  })

  it('accepts radio_with_other with only the free-text part filled', () => {
    const q: FormQuestion = { ...base, id: 'o', label: 'O', type: 'radio_with_other', options: ['A', 'B'] }
    const schema = buildFormResponseSchema(sectionOf(q), { enforceRequired: true })
    expect(schema.safeParse({ o: { selected: '', other: 'x' } }).success).toBe(true)
  })

  it('fails an empty required text question only when enforceRequired is on', () => {
    const q: FormQuestion = { ...base, required: true, id: 't', label: 'T', type: 'text' }
    expect(buildFormResponseSchema(sectionOf(q), { enforceRequired: true }).safeParse({ t: '' }).success).toBe(false)
    expect(buildFormResponseSchema(sectionOf(q), { enforceRequired: false }).safeParse({ t: '' }).success).toBe(true)
  })

  it('strips answers for question ids that are not in the template', () => {
    const q: FormQuestion = { ...base, id: 't', label: 'T', type: 'text' }
    const r = buildFormResponseSchema(sectionOf(q), { enforceRequired: false }).parse({ t: 'a', gone: 'b' })
    expect(r).toEqual({ t: 'a' })
  })

  // The public link accepts these without a session; each answer needs a size bound.
  it.each<[string, unknown, boolean]>([
    ['text at the length limit', { t: 'a'.repeat(FORM_LIMITS.textLength) }, true],
    ['text over the length limit', { t: 'a'.repeat(FORM_LIMITS.textLength + 1) }, false],
    ['"other" over the length limit', { o: { selected: '', other: 'a'.repeat(FORM_LIMITS.textLength + 1) } }, false],
    ['list at the row limit', { meds: Array.from({ length: FORM_LIMITS.listRows }, () => ({ name: 'A' })) }, true],
    ['list over the row limit', { meds: Array.from({ length: FORM_LIMITS.listRows + 1 }, () => ({ name: 'A' })) }, false],
  ])('%s', (_name, input, valid) => {
    const t: FormQuestion = { ...base, id: 't', label: 'T', type: 'text' }
    const o: FormQuestion = { ...base, id: 'o', label: 'O', type: 'radio_with_other', options: ['A', 'B'] }
    const schema = buildFormResponseSchema(sectionOf(t, o, list), { enforceRequired: false })
    expect(schema.safeParse(input).success).toBe(valid)
  })
})
