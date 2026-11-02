import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FaceDiagramPdfSection } from '../diagram-pdf'
import type { DiagramWithPoints } from '@/db/queries/face-diagrams'

const diagram = {
  id: 'd1',
  viewType: 'front',
  points: [
    { id: 'p1', x: 25, y: 40, productName: 'Botox Allergan', quantity: '10', quantityUnit: 'U' },
    { id: 'p2', x: 60, y: 70, productName: 'Juvederm', quantity: '1', quantityUnit: 'mL' },
  ],
} as unknown as DiagramWithPoints

describe('FaceDiagramPdfSection', () => {
  it('places each marker at its point percentage over the gendered front template', () => {
    const html = renderToStaticMarkup(
      <FaceDiagramPdfSection diagrams={[diagram]} gender="feminino" />,
    )
    expect(html).toContain('left:25%;top:40%')
    expect(html).toContain('left:60%;top:70%')
    expect(html).toMatch(/<img[^>]*src="[^"]*female-front\.webp"/)
  })
})
