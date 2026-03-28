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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { DiagramPointData } from './types'
import type { QuantityUnit } from '@/types'

const DEPTH_OPTIONS = [
  { value: 'subcutâneo', label: 'Subcutâneo' },
  { value: 'intradérmico', label: 'Intradérmico' },
  { value: 'supraperiosteal', label: 'Supraperiosteal' },
  { value: 'subdérmico', label: 'Subdérmico' },
  { value: 'intramuscular', label: 'Intramuscular' },
] as const

interface PointFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  point: Partial<DiagramPointData> & { x: number; y: number }
  onSave: (point: DiagramPointData) => void
  onDelete?: () => void
  existingProducts?: string[]
}

export function PointFormModal({
  open,
  onOpenChange,
  point,
  onSave,
  onDelete,
  existingProducts = [],
}: PointFormModalProps) {
  const isEditing = !!point.id

  const [productName, setProductName] = React.useState(point.productName ?? '')
  const [activeIngredient, setActiveIngredient] = React.useState(
    point.activeIngredient ?? ''
  )
  const [quantity, setQuantity] = React.useState(
    point.quantity?.toString() ?? ''
  )
  const [quantityUnit, setQuantityUnit] = React.useState<QuantityUnit>(
    point.quantityUnit ?? 'U'
  )
  const [technique, setTechnique] = React.useState(point.technique ?? '')
  const [depth, setDepth] = React.useState(point.depth ?? '')
  const [notes, setNotes] = React.useState(point.notes ?? '')
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false)
  const [showSuggestions, setShowSuggestions] = React.useState(false)

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
    setShowSuggestions(false)
  }, [point])

  const filteredProducts = React.useMemo(() => {
    if (!productName.trim()) return existingProducts
    const lower = productName.toLowerCase()
    return existingProducts.filter((p) => p.toLowerCase().includes(lower))
  }, [productName, existingProducts])

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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Editar ponto' : 'Adicionar ponto'}
          </DialogTitle>
          <DialogDescription>
            Preencha os detalhes do produto aplicado neste ponto.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* Product name with autocomplete */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-name">Produto *</Label>
            <div className="relative">
              <Input
                id="product-name"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => {
                  // Delay to allow click on suggestion
                  setTimeout(() => setShowSuggestions(false), 150)
                }}
                placeholder="Nome do produto"
                required
                autoComplete="off"
              />
              {showSuggestions && filteredProducts.length > 0 && (
                <div className="absolute top-full left-0 z-50 mt-1 w-full rounded-md border bg-popover p-1 shadow-md">
                  {filteredProducts.map((product) => (
                    <button
                      key={product}
                      type="button"
                      className="w-full rounded-sm px-2 py-1 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setProductName(product)
                        setShowSuggestions(false)
                      }}
                    >
                      {product}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Active ingredient */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="active-ingredient">Princípio ativo</Label>
            <Input
              id="active-ingredient"
              value={activeIngredient}
              onChange={(e) => setActiveIngredient(e.target.value)}
              placeholder="Princípio ativo"
            />
          </div>

          {/* Quantity + Unit */}
          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="quantity">Quantidade *</Label>
              <Input
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
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-transparent hover:bg-muted'
                  }`}
                  onClick={() => setQuantityUnit('U')}
                >
                  U
                </button>
                <button
                  type="button"
                  className={`px-3 text-sm font-medium transition-colors ${
                    quantityUnit === 'mL'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-transparent hover:bg-muted'
                  }`}
                  onClick={() => setQuantityUnit('mL')}
                >
                  mL
                </button>
              </div>
            </div>
          </div>

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
            <Select value={depth} onValueChange={(val) => setDepth(val ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione a profundidade">
                  {(value: string) => DEPTH_OPTIONS.find((o) => o.value === value)?.label ?? value}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {DEPTH_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
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
