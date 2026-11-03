import type { DiagramWithPoints } from '@/db/queries/face-diagrams'
import type { DiagramViewType } from '@/types'
import type { DiagramPointData } from './types'

export const DIAGRAM_VIEW_TYPES: DiagramViewType[] = ['front', 'left_profile', 'right_profile']

export function diagramsToPoints(diagrams: DiagramWithPoints[] | undefined): DiagramPointData[] {
  return (diagrams ?? []).flatMap((diagram) =>
    diagram.points.map((p) => ({
      id: p.id,
      x: parseFloat(p.x),
      y: parseFloat(p.y),
      viewType: diagram.viewType || 'front',
      productName: p.productName,
      activeIngredient: p.activeIngredient ?? undefined,
      quantity: parseFloat(p.quantity),
      quantityUnit: p.quantityUnit as DiagramPointData['quantityUnit'],
      technique: p.technique ?? undefined,
      depth: p.depth ?? undefined,
      notes: p.notes ?? undefined,
    })),
  )
}

/** Every view, including empty ones, so a save also clears the views the user emptied. */
export function pointsToViews(points: Omit<DiagramPointData, 'id'>[]) {
  return DIAGRAM_VIEW_TYPES.map((viewType) => ({
    viewType,
    points: points
      .filter((p) => (p.viewType || 'front') === viewType)
      .map((p) => ({
        x: p.x,
        y: p.y,
        productName: p.productName,
        activeIngredient: p.activeIngredient,
        quantity: p.quantity,
        quantityUnit: p.quantityUnit,
        technique: p.technique,
        depth: p.depth,
        notes: p.notes,
      })),
  }))
}
