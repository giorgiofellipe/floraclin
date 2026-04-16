'use client'

import { useState, useMemo } from 'react'
import { CheckIcon, PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { DEFAULT_PRODUCTS } from '@/lib/constants'
import { CustomProductForm, type CustomProductInput } from './custom-product-form'

export interface ProductStepItem {
  name: string
  category: string
  activeIngredient: string
  defaultUnit: string
  isCustom: boolean
}

interface ProductsStepProps {
  selectedNames: Set<string>
  customProducts: ProductStepItem[]
  alreadyConfigured?: boolean
  onSelectionChange: (name: string, selected: boolean) => void
  onAddCustom: (product: CustomProductInput) => void
  onRemoveCustom: (name: string) => void
}

const CATEGORY_HEADERS: Record<string, string> = {
  botox: 'Toxina Botulínica',
  filler: 'Preenchedores',
  biostimulator: 'Bioestimuladores',
  skinbooster: 'Skinboosters',
  peel: 'Peelings',
  other: 'Outros',
}

export function ProductsStep({
  selectedNames,
  customProducts,
  alreadyConfigured = false,
  onSelectionChange,
  onAddCustom,
  onRemoveCustom,
}: ProductsStepProps) {
  const [showCustomForm, setShowCustomForm] = useState(false)

  const defaultsByCategory = useMemo(() => {
    const groups: Record<string, typeof DEFAULT_PRODUCTS[number][]> = {}
    for (const p of DEFAULT_PRODUCTS) {
      (groups[p.category] ??= []).push(p)
    }
    return groups
  }, [])

  const customsByCategory = useMemo(() => {
    const groups: Record<string, ProductStepItem[]> = {}
    for (const p of customProducts) {
      (groups[p.category] ??= []).push(p)
    }
    return groups
  }, [customProducts])

  const categories = ['botox', 'filler', 'biostimulator', 'skinbooster', 'peel', 'other'] as const

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-charcoal">Produtos</h2>
        <p className="text-sm text-mid mt-1">
          Selecione os produtos que sua clínica utiliza. Você poderá ajustar, editar ou adicionar novos a qualquer momento em Configurações.
        </p>
      </div>

      {alreadyConfigured && (
        <div className="rounded-lg border border-amber-dark/30 bg-amber-50/50 p-3 text-sm text-charcoal">
          Você já possui produtos cadastrados. As seleções abaixo <strong>não serão aplicadas</strong> — gerencie seu catálogo em Configurações.
        </div>
      )}

      {categories.map((cat) => {
        const defaults = defaultsByCategory[cat] ?? []
        const customs = customsByCategory[cat] ?? []
        if (defaults.length === 0 && customs.length === 0) return null

        return (
          <div key={cat} className="space-y-2">
            <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
              {CATEGORY_HEADERS[cat]}
            </h3>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
              {defaults.map((p) => {
                const checked = selectedNames.has(p.name)
                return (
                  <button
                    key={p.name}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={p.name}
                    data-product-row
                    onClick={() => onSelectionChange(p.name, !checked)}
                    className={cn(
                      'relative flex flex-col items-start gap-1 rounded-lg border p-3 text-left cursor-pointer transition-colors',
                      checked
                        ? 'border-forest bg-[#F0F7F1] ring-2 ring-forest/30'
                        : 'border-[#E8ECEF] bg-white hover:bg-[#F4F6F8]',
                    )}
                  >
                    {checked && (
                      <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-forest text-white">
                        <CheckIcon className="h-2.5 w-2.5" strokeWidth={3} />
                      </span>
                    )}
                    <span className="pr-6 text-sm font-medium text-charcoal leading-tight">{p.name}</span>
                    <span className="text-[11px] text-mid leading-tight line-clamp-1">{p.activeIngredient}</span>
                    <span className="text-[10px] text-mid tabular-nums mt-auto pt-1">{p.defaultUnit}</span>
                  </button>
                )
              })}
              {customs.map((p) => (
                <div
                  key={p.name}
                  data-product-row
                  className="relative flex flex-col items-start gap-1 rounded-lg border border-forest bg-[#F0F7F1] p-3 ring-2 ring-forest/30"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onRemoveCustom(p.name)}
                    aria-label={`Remover ${p.name}`}
                    className="absolute right-1 top-1 h-6 w-6"
                  >
                    <XIcon className="h-3.5 w-3.5 text-mid" />
                  </Button>
                  <span className="pr-6 text-sm font-medium text-charcoal leading-tight">{p.name}</span>
                  {p.activeIngredient && (
                    <span className="text-[11px] text-mid leading-tight line-clamp-1">{p.activeIngredient}</span>
                  )}
                  <div className="flex items-center gap-2 mt-auto pt-1">
                    <span className="inline-flex items-center rounded-full bg-forest text-white text-[10px] px-1.5 py-px font-medium">
                      Personalizado
                    </span>
                    <span className="text-[10px] text-mid tabular-nums">{p.defaultUnit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {showCustomForm ? (
        <CustomProductForm
          onAdd={(product) => {
            onAddCustom(product)
            setShowCustomForm(false)
          }}
          onCancel={() => setShowCustomForm(false)}
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowCustomForm(true)}
          className="border-sage/30 text-sage hover:bg-sage/5 hover:text-forest"
        >
          <PlusIcon className="h-4 w-4" />
          Adicionar outro produto
        </Button>
      )}
    </div>
  )
}
