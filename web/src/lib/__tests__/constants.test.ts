import { describe, it, expect } from 'vitest'
import { DEFAULT_PRODUCTS } from '../constants'

describe('DEFAULT_PRODUCTS', () => {
  it('contains 12 curated Brazilian-market products', () => {
    expect(DEFAULT_PRODUCTS).toHaveLength(12)
  })

  it('every product has required fields including origin', () => {
    for (const p of DEFAULT_PRODUCTS) {
      expect(p.name).toBeTruthy()
      expect(p.category).toBeTruthy()
      expect(p.activeIngredient).toBeTruthy()
      expect(p.defaultUnit).toBeTruthy()
      expect(['nacional', 'importado']).toContain(p.origin)
    }
  })

  it('includes the four expected categories', () => {
    const cats = new Set(DEFAULT_PRODUCTS.map((p) => p.category))
    expect(cats).toEqual(new Set(['botox', 'filler', 'biostimulator', 'skinbooster']))
  })

  it('includes the expected Brazilian-origin products', () => {
    const nacionais = DEFAULT_PRODUCTS.filter((p) => p.origin === 'nacional').map((p) => p.name)
    expect(nacionais).toContain('Botulift 100U')
    expect(nacionais).toContain('Biogelis')
    expect(nacionais).toContain('Rennova Elleva')
  })

  it('includes the expected imported staples', () => {
    const names = DEFAULT_PRODUCTS.map((p) => p.name)
    expect(names).toContain('Botox Allergan 100U')
    expect(names).toContain('Dysport 300U')
    expect(names).toContain('Sculptra')
    expect(names).toContain('Profhilo')
  })
})
