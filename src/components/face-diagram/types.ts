import type { QuantityUnit } from '@/types'

export interface DiagramPointData {
  id: string
  x: number // 0-100 relative
  y: number // 0-100 relative
  viewType?: string // 'front' | 'left_profile' | 'right_profile' — which face view this point belongs to
  productName: string
  activeIngredient?: string
  quantity: number
  quantityUnit: QuantityUnit
  technique?: string
  depth?: string
  notes?: string
}

export interface CatalogProduct {
  id: string
  name: string
  category: string
  activeIngredient: string | null
  defaultUnit: string
  isActive: boolean
}

export interface FaceDiagramEditorProps {
  points: DiagramPointData[]
  onChange: (points: DiagramPointData[]) => void
  previousPoints?: DiagramPointData[] // ghost overlay
  showComparison?: boolean // show changed quantities vs previousPoints (default: true when previousPoints exist)
  readOnly?: boolean
  gender?: string | null // inferred from patient — 'masculino' | 'feminino'
  products?: CatalogProduct[] // active products from catalog
}
