'use client'

import { useState, useMemo, useId } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  const idBase = useId()

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

      {categories.map((cat, catIdx) => {
        const defaults = defaultsByCategory[cat] ?? []
        const customs = customsByCategory[cat] ?? []
        if (defaults.length === 0 && customs.length === 0) return null

        return (
          <div key={cat} className="space-y-2">
            <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
              {CATEGORY_HEADERS[cat]}
            </h3>
            <div className="space-y-1.5">
              {defaults.map((p, i) => {
                const checked = selectedNames.has(p.name)
                const inputId = `${idBase}-default-${catIdx}-${i}`
                return (
                  <label
                    key={p.name}
                    htmlFor={inputId}
                    data-product-row
                    className="flex items-center gap-3 rounded-lg border border-[#E8ECEF] bg-white p-3 cursor-pointer hover:bg-[#F4F6F8] transition-colors"
                  >
                    <Checkbox
                      id={inputId}
                      checked={checked}
                      onCheckedChange={(v) => onSelectionChange(p.name, v === true)}
                      aria-label={p.name}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-charcoal">{p.name}</span>
                        {p.origin === 'nacional' && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#F0F7F1] text-forest text-[10px] px-2 py-0.5 font-medium">
                            🇧🇷 Nacional
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-mid">{p.activeIngredient}</span>
                    </div>
                    <span className="text-xs text-mid tabular-nums">{p.defaultUnit}</span>
                  </label>
                )
              })}
              {customs.map((p) => (
                <div
                  key={p.name}
                  data-product-row
                  className="flex items-center gap-3 rounded-lg border border-forest/40 bg-[#F0F7F1] p-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-charcoal">{p.name}</span>
                      <span className="inline-flex items-center rounded-full bg-forest text-white text-[10px] px-2 py-0.5 font-medium">
                        Personalizado
                      </span>
                    </div>
                    {p.activeIngredient && (
                      <span className="text-xs text-mid">{p.activeIngredient}</span>
                    )}
                  </div>
                  <span className="text-xs text-mid tabular-nums">{p.defaultUnit}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onRemoveCustom(p.name)}
                    aria-label={`Remover ${p.name}`}
                  >
                    <XIcon className="h-4 w-4 text-mid" />
                  </Button>
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
        >
          <PlusIcon className="h-4 w-4" />
          Adicionar produto personalizado
        </Button>
      )}
    </div>
  )
}
