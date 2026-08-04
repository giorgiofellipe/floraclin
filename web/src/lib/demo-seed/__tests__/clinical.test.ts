import { describe, it, expect } from 'vitest'
import {
  FEATURED_PATIENT_COUNT,
  buildAnamnesis,
  buildProcedureNotes,
  buildFaceDiagramPoints,
  buildProductApplications,
} from '../clinical'
import { CATALOGUE } from '../config'
import { parseBrDate } from '@/lib/dates'
import type { SeededPatient } from '../types'

function makePatient(overrides: Partial<SeededPatient> & { fullName: string }): SeededPatient {
  return {
    id: crypto.randomUUID(),
    cpf: '000.000.000-00',
    birthDate: '1995-01-01',
    gender: 'feminino',
    email: 'paciente@example.com',
    phone: '(11) 90000-0001',
    referralSource: 'instagram',
    ...overrides,
  }
}

const FEATURED_PATIENTS: SeededPatient[] = [
  'Maria Silva',
  'Fernanda Souza',
  'Camila Oliveira',
  'Beatriz Santos',
  'Larissa Pereira',
  'Gabriela Costa',
].map((fullName) => makePatient({ fullName }))

/**
 * Known per-procedure product keywords, independent of the source module's
 * internal product-rotation arrays, so the assertion actually proves the
 * generated text names a real product rather than just re-checking the
 * implementation against itself.
 */
const PRODUCT_KEYWORDS: Record<string, string[]> = {
  'Toxina botulínica completa': ['Botox', 'Dysport', 'Xeomin'],
  'Toxina botulínica parcial (glabela/testa)': ['Botox', 'Dysport', 'Xeomin'],
  'Preenchimento de olheiras': ['Juvederm', 'Restylane', 'Belotero'],
  'Preenchimento malar': ['Juvederm', 'Restylane', 'Belotero'],
  'Preenchimento labial': ['Juvederm', 'Restylane', 'Belotero'],
  'Harmonização facial completa': ['Botox', 'Dysport', 'Xeomin'],
  'Bioestimulador de colágeno (Sculptra)': ['Sculptra'],
  Skinbooster: ['Profhilo'],
  'Limpeza de pele profunda': ['ácido salicílico'],
}

describe('FEATURED_PATIENT_COUNT', () => {
  it('is 6', () => {
    expect(FEATURED_PATIENT_COUNT).toBe(6)
  })
})

describe('buildAnamnesis', () => {
  it('produces all three non-empty sections for every featured patient', () => {
    FEATURED_PATIENTS.forEach((patient, index) => {
      const anamnesis = buildAnamnesis(patient, index)

      expect(anamnesis.allergies.length).toBeGreaterThan(0)
      for (const entry of anamnesis.allergies) expect(entry.trim().length).toBeGreaterThan(0)

      expect(anamnesis.medications.length).toBeGreaterThan(0)
      for (const entry of anamnesis.medications) expect(entry.trim().length).toBeGreaterThan(0)

      expect(anamnesis.history.trim().length).toBeGreaterThan(0)
    })
  })

  it('produces all three non-empty sections beyond the featured range too', () => {
    for (let index = 0; index < 20; index++) {
      const anamnesis = buildAnamnesis(makePatient({ fullName: `Paciente ${index}` }), index)
      expect(anamnesis.allergies.length).toBeGreaterThan(0)
      expect(anamnesis.medications.length).toBeGreaterThan(0)
      expect(anamnesis.history.trim().length).toBeGreaterThan(0)
    }
  })

  it('writes content in Portuguese, not placeholder text', () => {
    const anamnesis = buildAnamnesis(FEATURED_PATIENTS[0], 0)
    const combined = [...anamnesis.allergies, ...anamnesis.medications, anamnesis.history].join(' ')
    expect(combined.toLowerCase()).not.toContain('lorem ipsum')
  })

  it('gives no two featured patients identical anamnesis text', () => {
    const texts = FEATURED_PATIENTS.map((patient, index) => {
      const anamnesis = buildAnamnesis(patient, index)
      return JSON.stringify([anamnesis.allergies, anamnesis.medications, anamnesis.history])
    })
    expect(new Set(texts).size).toBe(FEATURED_PATIENTS.length)
  })

  it('gives no two featured patients identical history text on its own', () => {
    const histories = FEATURED_PATIENTS.map((patient, index) => buildAnamnesis(patient, index).history)
    expect(new Set(histories).size).toBe(FEATURED_PATIENTS.length)
  })

  it('is deterministic for the same patient and index', () => {
    const first = buildAnamnesis(FEATURED_PATIENTS[0], 0)
    const second = buildAnamnesis(FEATURED_PATIENTS[0], 0)
    expect(second).toEqual(first)
  })
})

describe('buildProcedureNotes', () => {
  it('names the actual product for every catalogue procedure', () => {
    for (const item of CATALOGUE) {
      for (let index = 0; index < 3; index++) {
        const result = buildProcedureNotes(item.name, index)

        expect(result.technique.trim().length).toBeGreaterThan(0)
        expect(result.notes.trim().length).toBeGreaterThan(0)
        expect(result.clinicalResponse.trim().length).toBeGreaterThan(0)

        const keywords = PRODUCT_KEYWORDS[item.name]
        expect(keywords, `no product keyword list for "${item.name}"`).toBeDefined()
        const mentionsProduct = keywords.some((keyword) => result.notes.includes(keyword))
        expect(mentionsProduct, `notes for "${item.name}" (index ${index}) do not mention a known product: ${result.notes}`).toBe(true)
      }
    }
  })

  it('throws for an unknown procedure name', () => {
    expect(() => buildProcedureNotes('Procedimento inexistente', 0)).toThrow()
  })
})

describe('buildFaceDiagramPoints', () => {
  it('gives every toxina procedure points dosed in U', () => {
    const toxinaItems = CATALOGUE.filter((item) => item.category === 'toxina')
    expect(toxinaItems.length).toBeGreaterThan(0)
    for (const item of toxinaItems) {
      const points = buildFaceDiagramPoints(item.name)
      expect(points.length).toBeGreaterThan(0)
      for (const point of points) expect(point.quantityUnit).toBe('U')
    }
  })

  it('gives every preenchimento procedure points dosed in mL', () => {
    const preenchimentoItems = CATALOGUE.filter((item) => item.category === 'preenchimento')
    expect(preenchimentoItems.length).toBeGreaterThan(0)
    for (const item of preenchimentoItems) {
      const points = buildFaceDiagramPoints(item.name)
      expect(points.length).toBeGreaterThan(0)
      for (const point of points) expect(point.quantityUnit).toBe('mL')
    }
  })

  it('places toxina points on testa, glabela or pés de galinha', () => {
    const points = buildFaceDiagramPoints('Toxina botulínica completa')
    for (const point of points) {
      expect(point.notes.toLowerCase()).toMatch(/frontal|glabela|corrugador|prócero|pé de galinha/)
    }
  })

  it('places preenchimento points on lábios, malar or olheiras', () => {
    const malar = buildFaceDiagramPoints('Preenchimento malar').every((p) => p.notes.toLowerCase().includes('malar'))
    const lips = buildFaceDiagramPoints('Preenchimento labial').every((p) => p.notes.toLowerCase().includes('lábio'))
    const underEye = buildFaceDiagramPoints('Preenchimento de olheiras').every((p) => p.notes.toLowerCase().includes('olheira'))
    expect(malar).toBe(true)
    expect(lips).toBe(true)
    expect(underEye).toBe(true)
  })

  it('keeps every point coordinate inside the 0-100 diagram bounds', () => {
    for (const item of CATALOGUE) {
      const points = buildFaceDiagramPoints(item.name)
      for (const point of points) {
        expect(point.x).toBeGreaterThanOrEqual(0)
        expect(point.x).toBeLessThanOrEqual(100)
        expect(point.y).toBeGreaterThanOrEqual(0)
        expect(point.y).toBeLessThanOrEqual(100)
      }
    }
  })

  it('assigns every point a positive quantity, a product and an active ingredient', () => {
    for (const item of CATALOGUE) {
      const points = buildFaceDiagramPoints(item.name)
      for (const point of points) {
        expect(point.quantity).toBeGreaterThan(0)
        expect(point.productName.trim().length).toBeGreaterThan(0)
        expect(point.activeIngredient.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('assigns sequential sortOrder starting at 0', () => {
    const points = buildFaceDiagramPoints('Toxina botulínica completa')
    expect(points.map((p) => p.sortOrder)).toEqual(points.map((_, i) => i))
  })

  it('returns no points for the non-injectable Limpeza de pele profunda', () => {
    expect(buildFaceDiagramPoints('Limpeza de pele profunda')).toEqual([])
  })

  it('is deterministic for the same procedure name', () => {
    const first = buildFaceDiagramPoints('Preenchimento malar')
    const second = buildFaceDiagramPoints('Preenchimento malar')
    expect(second).toEqual(first)
  })

  it('throws for an unknown procedure name', () => {
    expect(() => buildFaceDiagramPoints('Procedimento inexistente')).toThrow()
  })

  it('covers every catalogue entry without throwing', () => {
    for (const item of CATALOGUE) {
      expect(() => buildFaceDiagramPoints(item.name)).not.toThrow()
    }
  })
})

describe('buildProductApplications', () => {
  const PROCEDURE_DATE = parseBrDate('2026-03-10')

  it('sums to the same total quantity, per product, as buildFaceDiagramPoints', () => {
    for (const item of CATALOGUE) {
      const points = buildFaceDiagramPoints(item.name)
      const applications = buildProductApplications(item.name, 0, PROCEDURE_DATE)

      const expectedByProduct = new Map<string, number>()
      for (const point of points) {
        const key = `${point.productName}||${point.activeIngredient}||${point.quantityUnit}`
        expectedByProduct.set(key, (expectedByProduct.get(key) ?? 0) + point.quantity)
      }

      const actualByProduct = new Map<string, number>()
      for (const app of applications) {
        const key = `${app.productName}||${app.activeIngredient}||${app.quantityUnit}`
        actualByProduct.set(key, app.totalQuantity)
      }

      expect(actualByProduct.size, `product count mismatch for "${item.name}"`).toBe(expectedByProduct.size)
      for (const [key, expectedQuantity] of expectedByProduct) {
        expect(actualByProduct.get(key), `quantity mismatch for "${item.name}" / ${key}`).toBeCloseTo(
          expectedQuantity,
          2,
        )
      }
    }
  })

  it('gives every row a non-empty batch number', () => {
    for (const item of CATALOGUE) {
      const applications = buildProductApplications(item.name, 0, PROCEDURE_DATE)
      for (const app of applications) {
        expect(app.batchNumber.trim().length).toBeGreaterThan(0)
        // Letter prefix plus digits, e.g. "BOT4821".
        expect(app.batchNumber).toMatch(/^[A-Z]+[0-9]+$/)
      }
    }
  })

  it('varies the batch number across repeat visits (index) for the same procedure', () => {
    const first = buildProductApplications('Toxina botulínica completa', 0, PROCEDURE_DATE)
    const second = buildProductApplications('Toxina botulínica completa', 1, PROCEDURE_DATE)
    expect(first[0].batchNumber).not.toBe(second[0].batchNumber)
  })

  it('gives every row an expiration date strictly after the procedure date', () => {
    for (const item of CATALOGUE) {
      const applications = buildProductApplications(item.name, 0, PROCEDURE_DATE)
      for (const app of applications) {
        const expiration = parseBrDate(app.expirationDate)
        expect(expiration.getTime()).toBeGreaterThan(PROCEDURE_DATE.getTime())
      }
    }
  })

  it('produces no applications for the non-injectable Limpeza de pele profunda', () => {
    expect(buildProductApplications('Limpeza de pele profunda', 0, PROCEDURE_DATE)).toEqual([])
  })

  it('carries the applicationAreas and product/ingredient fields non-empty', () => {
    const applications = buildProductApplications('Harmonização facial completa', 0, PROCEDURE_DATE)
    expect(applications.length).toBeGreaterThan(0)
    for (const app of applications) {
      expect(app.productName.trim().length).toBeGreaterThan(0)
      expect(app.activeIngredient.trim().length).toBeGreaterThan(0)
      expect(app.applicationAreas.trim().length).toBeGreaterThan(0)
      expect(app.notes.trim().length).toBeGreaterThan(0)
    }
  })

  it('is deterministic for the same inputs', () => {
    const first = buildProductApplications('Preenchimento malar', 2, PROCEDURE_DATE)
    const second = buildProductApplications('Preenchimento malar', 2, PROCEDURE_DATE)
    expect(second).toEqual(first)
  })

  it('throws for an unknown procedure name', () => {
    expect(() => buildProductApplications('Procedimento inexistente', 0, PROCEDURE_DATE)).toThrow()
  })
})
