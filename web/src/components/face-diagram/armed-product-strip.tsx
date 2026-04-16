'use client'

import * as React from 'react'
import { ProductAutocomplete } from './product-autocomplete'
import type { CatalogProduct } from './types'

interface ArmedProductStripProps {
  products: CatalogProduct[]
  armedProductId: string | null
  onArmedProductIdChange: (id: string | null) => void
  disabled?: boolean
  /** Override the outer wrapper className (defaults to `mb-3`). */
  className?: string
  /** Hide the helper text below the strip. Useful when rendered as an overlay header. */
  hideHint?: boolean
}

export function ArmedProductStrip({
  products,
  armedProductId,
  onArmedProductIdChange,
  disabled,
  className,
  hideHint,
}: ArmedProductStripProps) {
  const activeProducts = React.useMemo(
    () => products.filter((p) => p.isActive),
    [products],
  )
  const armedProduct = React.useMemo(
    () => activeProducts.find((p) => p.id === armedProductId) ?? null,
    [activeProducts, armedProductId],
  )

  return (
    <div className={className ?? 'mb-3'} data-testid="armed-product-strip">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[12px] font-medium uppercase tracking-wider text-mid">
          Produto
        </span>
        <div className="flex-1 min-w-0">
          <ProductAutocomplete
            products={products}
            selectedProductId={armedProductId}
            onProductSelect={(p) => onArmedProductIdChange(p.id)}
            disabled={disabled}
            triggerTestId="armed-product-trigger"
          />
        </div>
      </div>
      {!hideHint && !armedProduct && activeProducts.length > 0 && !disabled && (
        <p className="mt-1.5 text-[11px] text-mid">
          Selecione um produto para começar a marcar pontos.
        </p>
      )}
      {!hideHint && activeProducts.length === 0 && !disabled && (
        <p className="mt-1.5 text-[11px] text-mid">
          Configure produtos no catálogo para usar o diagrama.
        </p>
      )}
    </div>
  )
}
