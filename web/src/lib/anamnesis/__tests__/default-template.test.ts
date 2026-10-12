import { describe, expect, it } from 'vitest'
import { DEFAULT_ANAMNESIS_TEMPLATE } from '../default-template'
import { anamnesisSectionsSchema } from '../schemas'

describe('DEFAULT_ANAMNESIS_TEMPLATE', () => {
  it('passes the server template schema (a rejected default breaks the first save after "Restaurar padrão")', () => {
    expect(anamnesisSectionsSchema.safeParse(DEFAULT_ANAMNESIS_TEMPLATE.sections).success).toBe(true)
  })
})
