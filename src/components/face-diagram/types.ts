import type { QuantityUnit } from '@/types'

export interface DiagramPointData {
  id: string
  x: number // 0-100 relative
  y: number // 0-100 relative
  productName: string
  activeIngredient?: string
  quantity: number
  quantityUnit: QuantityUnit
  technique?: string
  depth?: string
  notes?: string
}

export interface FaceDiagramEditorProps {
  points: DiagramPointData[]
  onChange: (points: DiagramPointData[]) => void
  previousPoints?: DiagramPointData[] // ghost overlay
  readOnly?: boolean
}
