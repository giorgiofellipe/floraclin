'use client'

import * as React from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { CatalogProduct } from './types'
import { PROCEDURE_CATEGORY_LABELS as CATEGORY_LABELS } from '@/lib/constants'

const CATEGORY_ORDER = [
  'botox',
  'filler',
  'biostimulator',
  'peel',
  'skinbooster',
  'laser',
  'microagulhamento',
  'outros',
]

interface ProductAutocompleteProps {
  products: CatalogProduct[]
  selectedProductId: string | null
  onProductSelect: (product: CatalogProduct) => void
  disabled?: boolean
  placeholder?: string
  /** Optional test id for the trigger button */
  triggerTestId?: string
}

/**
 * Autocomplete combobox for picking a single product from the catalog.
 *
 * Built on Base UI's Popover primitive because the project's Select component
 * does not support type-to-filter search. Used in two places:
 *
 * - `<ArmedProductStrip>` — arms a product so clicks on the face canvas drop
 *   points pre-filled with that product (speeds up repeat placement).
 * - `<PointFormModal>` — per-point product picker when editing or adding a
 *   point via the modal.
 *
 * Only active products appear. Filters by name (case-insensitive substring).
 * Groups by category in a canonical order.
 */
export function ProductAutocomplete({
  products,
  selectedProductId,
  onProductSelect,
  disabled,
  placeholder = 'Buscar produto...',
  triggerTestId = 'product-autocomplete-trigger',
}: ProductAutocompleteProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  const activeProducts = React.useMemo(
    () => products.filter((p) => p.isActive),
    [products],
  )

  const selectedProduct = React.useMemo(
    () => activeProducts.find((p) => p.id === selectedProductId) ?? null,
    [activeProducts, selectedProductId],
  )

  // Focus the search input when the popover opens; clear the search on close
  React.useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => searchInputRef.current?.focus(), 0)
      return () => window.clearTimeout(id)
    }
    setSearch('')
    return undefined
  }, [open])

  const filteredByCategory = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    const matches = activeProducts.filter((p) => {
      if (!q) return true
      return p.name.toLowerCase().includes(q)
    })
    const groups: Record<string, CatalogProduct[]> = {}
    for (const p of matches) {
      const key = p.category || 'outros'
      if (!groups[key]) groups[key] = []
      groups[key].push(p)
    }
    for (const list of Object.values(groups)) {
      list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    }
    const sortedEntries: Array<[string, CatalogProduct[]]> = []
    for (const cat of CATEGORY_ORDER) {
      if (groups[cat]) sortedEntries.push([cat, groups[cat]])
    }
    for (const [cat, list] of Object.entries(groups)) {
      if (!CATEGORY_ORDER.includes(cat)) sortedEntries.push([cat, list])
    }
    return sortedEntries
  }, [activeProducts, search])

  const totalMatches = React.useMemo(
    () => filteredByCategory.reduce((acc, [, list]) => acc + list.length, 0),
    [filteredByCategory],
  )

  function handleSelect(product: CatalogProduct) {
    onProductSelect(product)
    setOpen(false)
  }

  const triggerDisabled = disabled || activeProducts.length === 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={triggerDisabled}
        render={
          <button
            type="button"
            data-testid={triggerTestId}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-lg border border-sage/20 bg-white px-3 py-2 text-left text-sm transition-colors',
              'hover:border-sage/40 focus:outline-none focus:ring-2 focus:ring-sage/30',
              triggerDisabled && 'cursor-not-allowed opacity-50',
            )}
          />
        }
      >
        <span
          className={cn(
            'truncate',
            selectedProduct ? 'text-charcoal' : 'text-mid/60',
          )}
        >
          {selectedProduct ? selectedProduct.name : placeholder}
        </span>
        <ChevronDown className="size-4 text-mid shrink-0" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--anchor-width)] max-w-[calc(100vw-2rem)] p-0"
      >
        <div className="flex items-center gap-2 border-b border-[#E8ECEF] px-3 py-2">
          <Search className="size-4 text-mid shrink-0" />
          <Input
            ref={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar produto..."
            className="h-7 border-0 px-0 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            data-testid="product-autocomplete-search"
          />
        </div>
        <div
          className="max-h-[320px] overflow-y-auto py-1"
          data-testid="product-autocomplete-list"
        >
          {totalMatches === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-mid">
              Nenhum produto encontrado
            </div>
          ) : (
            filteredByCategory.map(([category, list]) => (
              <div key={category} className="py-1">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-mid/70">
                  {CATEGORY_LABELS[category] ?? category}
                </div>
                {list.map((p) => {
                  const isSelected = p.id === selectedProductId
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelect(p)}
                      data-testid={`product-autocomplete-option-${p.id}`}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                        isSelected
                          ? 'bg-sage/10 text-forest'
                          : 'text-charcoal hover:bg-[#F4F6F8]',
                      )}
                    >
                      <span className="flex-1 truncate">{p.name}</span>
                      {p.activeIngredient && (
                        <span className="shrink-0 text-[11px] text-mid">
                          {p.activeIngredient}
                        </span>
                      )}
                      {isSelected && <Check className="size-4 shrink-0 text-forest" />}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
