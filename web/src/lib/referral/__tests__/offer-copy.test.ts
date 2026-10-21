import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { referralOfferHeadline } from '../offer-copy'

describe('referralOfferHeadline', () => {
  it('names the referrer and the offer', () => {
    expect(
      referralOfferHeadline({ referrerName: 'Clínica Bela', label: '20% de desconto nos 2 primeiros meses' }),
    ).toBe('Indicação de Clínica Bela: 20% de desconto nos 2 primeiros meses.')
  })

  it('shortens a long clinic name', () => {
    const out = referralOfferHeadline({
      referrerName: 'Clínica de Estética Avançada e Harmonização Facial Bela Vista',
      label: '20% de desconto',
    })
    expect(out).toBe('Indicação de Clínica de Estética Avançada e…: 20% de desconto.')
  })
})

describe('import boundary', () => {
  it('only value-imports ./rules and ./types (it is bundled into a client component)', () => {
    const source = readFileSync(path.resolve(__dirname, '../offer-copy.ts'), 'utf8')
    const specifiers = [...source.matchAll(/^import\s+(type\s+)?[^'"]*from\s+['"]([^'"]+)['"]/gm)]
      .filter((m) => !m[1])
      .map((m) => m[2])
    expect(specifiers.length).toBeGreaterThan(0)
    for (const spec of specifiers) expect(['./rules', './types']).toContain(spec)
  })
})
