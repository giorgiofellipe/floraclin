import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DiagramSummary } from '../diagram-summary'
import type { DiagramPointData } from '../types'

// The quantity and unit are rendered in separate nested spans ("8" and "U"),
// so the combined text ("8U") is not matchable as a single text node. This
// helper returns a matcher that resolves true on the parent element whose
// normalized textContent equals the expected value AND whose children don't
// individually contain the whole string.
function combinedText(expected: string) {
  return (_: string, element: Element | null) => {
    if (!element) return false
    const normalized = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (normalized !== expected) return false
    return Array.from(element.children).every(
      (child) => (child.textContent ?? '').replace(/\s+/g, ' ').trim() !== expected,
    )
  }
}

function makePoint(overrides: Partial<DiagramPointData> = {}): DiagramPointData {
  return {
    id: 'pt-1',
    x: 50,
    y: 50,
    productName: 'Botox',
    quantity: 5,
    quantityUnit: 'U',
    ...overrides,
  }
}

describe('DiagramSummary', () => {
  it('shows correct totals grouped by product', () => {
    const points: DiagramPointData[] = [
      makePoint({ id: 'p1', productName: 'Botox', quantity: 5, quantityUnit: 'U' }),
      makePoint({ id: 'p2', productName: 'Botox', quantity: 3, quantityUnit: 'U' }),
      makePoint({ id: 'p3', productName: 'Juvederm', quantity: 1, quantityUnit: 'mL' }),
    ]

    render(<DiagramSummary points={points} />)

    // Total for Botox: 8U — quantity and unit are in separate spans, so use a combined matcher
    expect(screen.getByText(combinedText('8U'))).toBeInTheDocument()
    // "Botox" appears in both the totals group and the points list
    expect(screen.getAllByText('Botox').length).toBeGreaterThanOrEqual(1)

    // Total for Juvederm: 1mL (appears in both totals and points list)
    expect(screen.getAllByText(combinedText('1mL')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Juvederm').length).toBeGreaterThanOrEqual(1)
  })

  it('shows correct point count', () => {
    const points: DiagramPointData[] = [
      makePoint({ id: 'p1' }),
      makePoint({ id: 'p2' }),
      makePoint({ id: 'p3' }),
    ]

    render(<DiagramSummary points={points} />)

    // "3 pontos" appears in both the header (total count) and the Botox group row
    expect(screen.getAllByText('3 pontos').length).toBeGreaterThanOrEqual(1)
  })

  it('handles empty points array', () => {
    render(<DiagramSummary points={[]} />)

    expect(screen.getByText('0 pontos')).toBeInTheDocument()
    expect(
      screen.getByText('Clique no rosto para adicionar pontos de aplicação.'),
    ).toBeInTheDocument()
  })

  it('groups by product name and unit correctly', () => {
    const points: DiagramPointData[] = [
      makePoint({ id: 'p1', productName: 'Radiesse', quantity: 1.5, quantityUnit: 'mL' }),
      makePoint({ id: 'p2', productName: 'Radiesse', quantity: 0.5, quantityUnit: 'mL' }),
    ]

    render(<DiagramSummary points={points} />)

    // 1.5 + 0.5 = 2mL — quantity and unit are in separate spans
    expect(screen.getByText(combinedText('2mL'))).toBeInTheDocument()
    // "2 pontos" appears in both header and the Radiesse group row
    expect(screen.getAllByText('2 pontos').length).toBeGreaterThanOrEqual(1)
  })
})
