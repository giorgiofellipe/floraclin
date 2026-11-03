import { describe, it, expect } from 'vitest'
import { resolveSection } from '../patient-sections'

describe('resolveSection', () => {
  it.each([
    ['procedimentos', 'owner', 'resumo'],
    ['timeline', 'owner', 'resumo'],
    ['evolucoes', 'receptionist', 'resumo'],
    ['evolucoes', 'practitioner', 'evolucoes'],
    ['financeiro', 'receptionist', 'financeiro'],
    [null, 'owner', 'resumo'],
    [undefined, 'owner', 'resumo'],
  ] as const)('%s for %s -> %s', (param, role, expected) => {
    expect(resolveSection(param, role)).toBe(expected)
  })
})
