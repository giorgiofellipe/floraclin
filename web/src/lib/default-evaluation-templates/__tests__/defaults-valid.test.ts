import { describe, expect, it } from 'vitest'
import { formSectionsSchema } from '@/lib/forms/sections-schema'
import { defaultTemplates } from '../index'

describe('default evaluation templates', () => {
  // Regression: after "Restaurar padrão", the next save of an untouched default would be rejected.
  it.each(defaultTemplates.map((t) => [t.name, t.sections] as const))('%s passes formSectionsSchema', (_name, sections) => {
    const result = formSectionsSchema.safeParse(sections)
    expect(result.error?.issues ?? []).toEqual([])
  })
})
