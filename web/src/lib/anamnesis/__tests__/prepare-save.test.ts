import { describe, expect, it } from 'vitest'
import type { FormSection } from '@/lib/forms/types'
import { prepareAnamnesisSave } from '../prepare-save'

const sections = (questions: FormSection['questions']): FormSection[] => [
  { id: 's', title: 'S', order: 0, questions },
]
const textQ = (id: string, order: number) => ({ id, label: id, type: 'text' as const, required: false, order })
const requiredRadio = {
  id: 'q-new', label: 'Nova', type: 'radio' as const, required: true, order: 2, options: ['Sim', 'Não'],
}

const recordSections = sections([textQ('q-old', 0), textQ('q-kept', 1)])
const currentSections = sections([textQ('q-kept', 0), requiredRadio])
const existing = { templateVersion: 2, templateSnapshot: recordSections, responses: { 'q-old': 'staff', 'q-kept': 'staff' } }
const current = { version: 3, sections: currentSections }

describe('prepareAnamnesisSave', () => {
  it('staff save on an existing row keeps the record snapshot and version (an edit must not move the record to the new template)', () => {
    const result = prepareAnamnesisSave({
      mode: 'staff', existing, current, body: { templateVersion: 2, responses: { 'q-old': 'a', 'q-kept': 'b' } },
    })
    expect(result).toEqual({
      ok: true,
      write: { templateVersion: 2, templateSnapshot: recordSections, responses: { 'q-old': 'a', 'q-kept': 'b' } },
    })
  })

  it.each([
    ['staff on a v2 record sent with v1', 'staff', existing, 1],
    ['new patient sent with v2 while current is v3 (no silent carry)', 'staff', null, 2],
    ['apply-current sent with v2 while current is v3', 'staff_apply_current', existing, 2],
  ] as const)('409 template_changed: %s', (_name, mode, row, templateVersion) => {
    const result = prepareAnamnesisSave({ mode, existing: row, current, body: { templateVersion, responses: {} } })
    expect(result).toMatchObject({ ok: false, status: 409, code: 'template_changed' })
  })

  it('409 stale when a client that had no row finds one (the patient submitted meanwhile)', () => {
    const result = prepareAnamnesisSave({
      mode: 'staff', existing, current, body: { templateVersion: 2, responses: {}, expectNoRow: true },
    })
    expect(result).toMatchObject({ ok: false, status: 409, code: 'stale' })
  })

  it('apply-current writes the current snapshot, skips required, and strips answers of removed questions', () => {
    const result = prepareAnamnesisSave({
      mode: 'staff_apply_current', existing, current,
      body: { templateVersion: 3, responses: { 'q-old': 'gone', 'q-kept': 'b' } },
    })
    expect(result).toEqual({
      ok: true,
      write: { templateVersion: 3, templateSnapshot: currentSections, responses: { 'q-kept': 'b' } },
    })
  })

  it('public submit of the current version enforces required questions', () => {
    const result = prepareAnamnesisSave({
      mode: 'public', existing, current, body: { templateVersion: 3, responses: { 'q-kept': 'b' } },
    })
    expect(result).toMatchObject({ ok: false, status: 400 })
  })

  it('public submit of an older version carries answers onto the current template without a 400', () => {
    const result = prepareAnamnesisSave({
      mode: 'public', existing, current, body: { templateVersion: 2, responses: { 'q-old': 'gone', 'q-kept': 'b' } },
    })
    expect(result).toEqual({
      ok: true,
      write: { templateVersion: 3, templateSnapshot: currentSections, responses: { 'q-kept': 'b' } },
    })
  })

  // Regression: a client naming a version above the current one skipped required questions.
  it('public submit naming a newer version than the current one still enforces required questions', () => {
    const result = prepareAnamnesisSave({
      mode: 'public', existing: null, current, body: { templateVersion: 4, responses: { 'q-kept': 'b' } },
    })
    expect(result).toMatchObject({ ok: false, status: 400 })
  })

  // Regression: the public submit replaced the whole record, erasing what staff had filled in.
  it('public submit over an existing record keeps staff answers the patient left blank and replaces the rest', () => {
    const atCurrent = { templateVersion: 3, templateSnapshot: currentSections, responses: { 'q-kept': 'staff', 'q-new': 'Sim' } }
    const result = prepareAnamnesisSave({
      mode: 'public', existing: atCurrent, current, body: { templateVersion: 3, responses: { 'q-kept': ' ', 'q-new': 'Não' } },
    })
    expect(result).toEqual({
      ok: true,
      write: { templateVersion: 3, templateSnapshot: currentSections, responses: { 'q-kept': 'staff', 'q-new': 'Não' } },
    })
  })
})
