'use client'

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ProductAutocomplete } from './product-autocomplete'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DiagramPointData, CatalogProduct } from './types'
import type { QuantityUnit } from '@/types'

const DEPTH_ITEMS: Record<string, string> = {
  'subcutâneo': 'Subcutâneo',
  'intradérmico': 'Intradérmico',
  'supraperiosteal': 'Supraperiosteal',
  'subdérmico': 'Subdérmico',
  'intramuscular': 'Intramuscular',
}

interface PointFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  point: Partial<DiagramPointData> & { x: number; y: number }
  onSave: (point: DiagramPointData) => void
  onDelete?: () => void
  products?: CatalogProduct[]
}

export function PointFormModal({
  open,
  onOpenChange,
  point,
  onSave,
  onDelete,
  products = [],
}: PointFormModalProps) {
  const isEditing = !!point.id

  const [selectedProductId, setSelectedProductId] = React.useState<string>('')
  const [productName, setProductName] = React.useState(point.productName ?? '')
  const [activeIngredient, setActiveIngredient] = React.useState(point.activeIngredient ?? '')
  const [quantity, setQuantity] = React.useState(point.quantity?.toString() ?? '')
  const [quantityUnit, setQuantityUnit] = React.useState<QuantityUnit>(point.quantityUnit ?? 'U')
  const [technique, setTechnique] = React.useState(point.technique ?? '')
  const [depth, setDepth] = React.useState(point.depth ?? '')
  const [notes, setNotes] = React.useState(point.notes ?? '')
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false)
  const [showDetails, setShowDetails] = React.useState(false)
  const quantityInputRef = React.useRef<HTMLInputElement>(null)

  // Auto-focus the quantity input for new points that already have a
  // pre-filled product (armed-product quick-entry flow). Editing an existing
  // point falls back to Base UI's default focus management.
  const shouldAutoFocusQuantity = !point.id && !!point.productName

  // Reset form when point changes
  React.useEffect(() => {
    setProductName(point.productName ?? '')
    setActiveIngredient(point.activeIngredient ?? '')
    setQuantity(point.quantity?.toString() ?? '')
    setQuantityUnit(point.quantityUnit ?? 'U')
    setTechnique(point.technique ?? '')
    setDepth(point.depth ?? '')
    setNotes(point.notes ?? '')
    setShowDeleteConfirm(false)
    setShowDetails(!!(point.technique || point.depth || point.notes))

    // Match existing point to a catalog product
    if (point.productName) {
      const match = products.find((p) => p.name === point.productName)
      setSelectedProductId(match?.id ?? '')
    } else {
      setSelectedProductId('')
    }
  }, [point, products])

  function handleProductSelect(product: CatalogProduct) {
    setSelectedProductId(product.id)
    setProductName(product.name)
    setActiveIngredient(product.activeIngredient ?? '')
    // Defensive cast — only accept valid QuantityUnit values, otherwise keep the current unit
    if (product.defaultUnit === 'U' || product.defaultUnit === 'mL') {
      setQuantityUnit(product.defaultUnit)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsedQuantity = parseFloat(quantity)
    if (!productName.trim() || isNaN(parsedQuantity) || parsedQuantity <= 0) {
      return
    }

    onSave({
      id: point.id ?? crypto.randomUUID(),
      x: point.x,
      y: point.y,
      viewType: point.viewType,
      productName: productName.trim(),
      activeIngredient: activeIngredient.trim() || undefined,
      quantity: parsedQuantity,
      quantityUnit,
      technique: technique.trim() || undefined,
      depth: depth || undefined,
      notes: notes.trim() || undefined,
    })
    onOpenChange(false)
  }

  function handleDelete() {
    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true)
      return
    }
    onDelete?.()
    onOpenChange(false)
  }

  const canSubmit =
    productName.trim() !== '' &&
    quantity !== '' &&
    !isNaN(parseFloat(quantity)) &&
    parseFloat(quantity) > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        initialFocus={shouldAutoFocusQuantity ? quantityInputRef : undefined}
      >
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Editar ponto' : 'Adicionar ponto'}
          </DialogTitle>
          <DialogDescription>
            Selecione o produto e a quantidade.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* Product autocomplete */}
          <div className="flex flex-col gap-1.5">
            <Label>Produto *</Label>
            <ProductAutocomplete
              products={products}
              selectedProductId={selectedProductId || null}
              onProductSelect={handleProductSelect}
              placeholder="Selecione o produto"
              triggerTestId="point-modal-product-autocomplete"
            />
            {selectedProductId && activeIngredient && (
              <p className="text-xs text-mid">
                Princípio ativo: {activeIngredient}
              </p>
            )}
          </div>

          {/* Quantity + Unit */}
          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="quantity">Quantidade *</Label>
              <Input
                ref={quantityInputRef}
                id="quantity"
                type="number"
                min="0.01"
                step="0.01"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Unidade</Label>
              <div className="flex h-8 overflow-hidden rounded-lg border border-input">
                <button
                  type="button"
                  className={`px-3 text-sm font-medium transition-colors ${
                    quantityUnit === 'U'
                      ? 'bg-forest text-cream'
                      : 'bg-transparent hover:bg-[#F0F7F1]'
                  }`}
                  onClick={() => setQuantityUnit('U')}
                >
                  U
                </button>
                <button
                  type="button"
                  className={`px-3 text-sm font-medium transition-colors ${
                    quantityUnit === 'mL'
                      ? 'bg-forest text-cream'
                      : 'bg-transparent hover:bg-[#F0F7F1]'
                  }`}
                  onClick={() => setQuantityUnit('mL')}
                >
                  mL
                </button>
              </div>
            </div>
          </div>

          {/* Optional expandable details */}
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm text-mid hover:text-charcoal transition-colors mt-1"
            onClick={() => setShowDetails(!showDetails)}
          >
            <ChevronDown
              className={cn(
                'size-4 transition-transform duration-200',
                showDetails && 'rotate-180'
              )}
            />
            Detalhes adicionais
          </button>

          {showDetails && (
            <div className="flex flex-col gap-3 border-t border-[#E8ECEF] pt-3">
              {/* Technique */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="technique">Técnica</Label>
                <Input
                  id="technique"
                  value={technique}
                  onChange={(e) => setTechnique(e.target.value)}
                  placeholder="Técnica utilizada"
                />
              </div>

              {/* Depth */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="depth">Profundidade</Label>
                <Select items={DEPTH_ITEMS} value={depth} onValueChange={(val) => setDepth(val ?? '')}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione a profundidade" />
                  </SelectTrigger>
                  <SelectContent />
                </Select>
              </div>

              {/* Notes */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="notes">Observações</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Observações sobre este ponto"
                  rows={2}
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            {isEditing && onDelete && (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                className="mr-auto"
              >
                {showDeleteConfirm ? 'Confirmar exclusão' : 'Excluir'}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isEditing ? 'Salvar' : 'Adicionar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
