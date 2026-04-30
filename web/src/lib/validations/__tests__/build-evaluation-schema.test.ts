import { describe, it, expect } from 'vitest'
import { buildEvaluationResponseSchema } from '../build-evaluation-schema'
import type { EvaluationSection } from '@/types/evaluation'

const sections: EvaluationSection[] = [
  {
    id: 'section-a',
    title: 'Avaliação',
    order: 1,
    questions: [
      { id: 'q-notes', label: 'Notas', type: 'text', required: true, order: 1 },
      { id: 'q-scale', label: 'Score', type: 'scale', required: false, order: 2, scaleMin: 0, scaleMax: 10 },
      { id: 'q-choice', label: 'Escolha', type: 'radio', required: true, order: 3, options: ['a', 'b'] },
      { id: 'q-multi', label: 'Múltiplo', type: 'checkbox', required: true, order: 4, options: ['x', 'y', 'z'] },
    ],
  },
]

const fixture = [{ id: 'template-1', sections }]

describe('buildEvaluationResponseSchema', () => {
  it('accepts a valid response with all required questions answered', () => {
    const schema = buildEvaluationResponseSchema(fixture)
    expect(
      schema.safeParse({
        'template-1': {
          'q-notes': 'ok',
          'q-scale': 7,
          'q-choice': 'a',
          'q-multi': ['x'],
        },
      }).success,
    ).toBe(true)
  })

  it('rejects when a required text question is empty', () => {
    const schema = buildEvaluationResponseSchema(fixture)
    expect(
      schema.safeParse({
        'template-1': { 'q-notes': '', 'q-choice': 'a', 'q-multi': ['x'] },
      }).success,
    ).toBe(false)
  })

  it('rejects when a required radio question is missing', () => {
    const schema = buildEvaluationResponseSchema(fixture)
    expect(
      schema.safeParse({
        'template-1': { 'q-notes': 'ok', 'q-choice': '', 'q-multi': ['x'] },
      }).success,
    ).toBe(false)
  })

  it('rejects when a required checkbox question is empty', () => {
    const schema = buildEvaluationResponseSchema(fixture)
    expect(
      schema.safeParse({
        'template-1': { 'q-notes': 'ok', 'q-choice': 'a', 'q-multi': [] },
      }).success,
    ).toBe(false)
  })

  it('allows optional scale question to be missing', () => {
    const schema = buildEvaluationResponseSchema(fixture)
    expect(
      schema.safeParse({
        'template-1': { 'q-notes': 'ok', 'q-choice': 'a', 'q-multi': ['x'] },
      }).success,
    ).toBe(true)
  })

  it('validates radio_with_other shape', () => {
    const t = [
      {
        id: 't',
        sections: [
          {
            id: 's',
            title: 'S',
            order: 1,
            questions: [
              { id: 'q', label: 'Q', type: 'radio_with_other' as const, required: true, order: 1 },
            ],
          },
        ],
      },
    ]
    const schema = buildEvaluationResponseSchema(t)
    expect(schema.safeParse({ t: { q: { selected: 'a', other: '' } } }).success).toBe(true)
    expect(schema.safeParse({ t: { q: { selected: '', other: '' } } }).success).toBe(false)
  })

  it('accepts any value for face_diagram (validated separately via diagramPoints)', () => {
    const t = [
      {
        id: 't',
        sections: [
          {
            id: 's',
            title: 'S',
            order: 1,
            questions: [
              { id: 'q', label: 'Q', type: 'face_diagram' as const, required: true, order: 1 },
            ],
          },
        ],
      },
    ]
    const schema = buildEvaluationResponseSchema(t)
    expect(schema.safeParse({ t: { q: { completed: true } } }).success).toBe(true)
    expect(schema.safeParse({ t: { q: undefined } }).success).toBe(true)
    expect(schema.safeParse({ t: {} }).success).toBe(true)
  })

  it('returns a permissive schema for empty templates list', () => {
    expect(buildEvaluationResponseSchema([]).safeParse({}).success).toBe(true)
  })
})
