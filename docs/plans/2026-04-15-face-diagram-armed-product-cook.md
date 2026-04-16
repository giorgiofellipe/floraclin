# Face Diagram Armed Product — Implementation Plan (revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the user arm a product once in the face diagram editor and drop points of that product with a minimal quick-entry modal (product pre-filled, quantity field focused) instead of re-selecting the product on every click.

**Spec:** `docs/superpowers/specs/2026-04-15-face-diagram-armed-product-design.md`

**Revision notes:** Adversarial review caught four must-fix issues before execution:
- **Base UI `PopoverTrigger` does not support `asChild`** — it uses `render` prop + `nativeButton={false}` (see `web/src/components/ui/date-picker.tsx:121` for the correct pattern). Original plan was based on Radix semantics.
- **Nested `<button>` inside `<button>`** for the clear button is invalid HTML. Revised plan places the `×` button as an absolutely-positioned sibling outside the trigger.
- **`setTimeout(50)` to "beat" the Dialog's focus trap** — incorrect. Base UI's `DialogPopup` accepts an `initialFocus` prop that forwards through `DialogContent`'s `...props`. Use that instead.
- **`defaultUnit as QuantityUnit` cast** — `CatalogProduct.defaultUnit` is `string`; any value outside `'U' | 'mL'` silently corrupts the pre-fill. Revised plan filters defensively.

Plus medium fixes: inactive-product filter, category sort order, test reliance on Base UI's popover mount animation.

**Tech stack:** React 19, TypeScript, Tailwind, Base UI (`@base-ui-components/react`), `@/components/ui/popover`, `@/components/ui/dialog`, `lucide-react`.

**Commit policy:** No commits until explicit user approval.

**Branch:** `feat/procedure-forms-rhf` (continuing the prior feature branch).

---

## File Structure

**New files:**
- `web/src/components/face-diagram/armed-product-strip.tsx` — autocomplete popover + clear button
- `web/src/components/face-diagram/__tests__/armed-product-strip.test.tsx` — unit tests

**Modified files:**
- `web/src/components/face-diagram/face-diagram-editor.tsx` — `armedProductId` state, render strip, pre-fill `editingPoint` from armed product
- `web/src/components/face-diagram/point-form-modal.tsx` — quantity input ref + `initialFocus` passthrough

## Parallelization Groups

```
Group A (parallel — 2 tasks, no shared files):
  A1: ArmedProductStrip component + tests
  A2: PointFormModal initialFocus wiring

Group B (sequential — depends on A):
  B1: FaceDiagramEditor integration
```

---

## Group A

### Task A1: ArmedProductStrip component + tests

**Files:**
- CREATE: `web/src/components/face-diagram/armed-product-strip.tsx`
- CREATE: `web/src/components/face-diagram/__tests__/armed-product-strip.test.tsx`

**Context to load before writing:**
- `web/src/components/face-diagram/types.ts` — `CatalogProduct` shape
- `web/src/components/ui/popover.tsx` — `Popover`/`PopoverTrigger`/`PopoverContent` wrappers
- `web/src/components/ui/date-picker.tsx` lines 116–140 — canonical example of `PopoverTrigger` with `render` + `nativeButton={false}`
- `web/src/components/ui/input.tsx` — `Input` component (forwards ref in React 19 via `...props`)
- `web/src/components/face-diagram/point-form-modal.tsx` — reference for `CATEGORY_LABELS`

- [ ] **Step 1: Write the component**

Create `web/src/components/face-diagram/armed-product-strip.tsx`:

```tsx
'use client'

import * as React from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { CatalogProduct } from './types'

const CATEGORY_LABELS: Record<string, string> = {
  botox: 'Toxina Botulínica',
  filler: 'Preenchimento',
  biostimulator: 'Bioestimulador',
  peel: 'Peeling',
  skinbooster: 'Skinbooster',
  laser: 'Laser',
  microagulhamento: 'Microagulhamento',
  outros: 'Outros',
}

// Canonical display order — matches CATEGORY_LABELS keys; unknown categories sort last
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

interface ArmedProductStripProps {
  products: CatalogProduct[]
  armedProductId: string | null
  onArmedProductIdChange: (id: string | null) => void
  disabled?: boolean
}

export function ArmedProductStrip({
  products,
  armedProductId,
  onArmedProductIdChange,
  disabled,
}: ArmedProductStripProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  // Only active products are selectable — inactive SKUs should not pollute plans
  const activeProducts = React.useMemo(
    () => products.filter((p) => p.isActive),
    [products],
  )

  const armedProduct = React.useMemo(
    () => activeProducts.find((p) => p.id === armedProductId) ?? null,
    [activeProducts, armedProductId],
  )

  // Focus the search input when the popover opens; clear the search text on close
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
    // Group + sort within each group alphabetically for consistent display
    const groups: Record<string, CatalogProduct[]> = {}
    for (const p of matches) {
      const key = p.category || 'outros'
      if (!groups[key]) groups[key] = []
      groups[key].push(p)
    }
    for (const list of Object.values(groups)) {
      list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    }
    // Return groups in canonical category order
    const sortedEntries: Array<[string, CatalogProduct[]]> = []
    for (const cat of CATEGORY_ORDER) {
      if (groups[cat]) sortedEntries.push([cat, groups[cat]])
    }
    // Append any unknown categories at the end
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
    onArmedProductIdChange(product.id)
    setOpen(false)
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    onArmedProductIdChange(null)
  }

  const triggerDisabled = disabled || activeProducts.length === 0

  return (
    <div className="mb-3" data-testid="armed-product-strip">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[12px] font-medium uppercase tracking-wider text-mid">
          Produto
        </span>
        {/* Wrapper is position:relative so the clear button can sit over the trigger
            without being a nested <button> (invalid HTML). */}
        <div className="relative flex-1">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              disabled={triggerDisabled}
              render={
                <button
                  type="button"
                  data-testid="armed-product-trigger"
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg border border-sage/20 bg-white py-2 pl-3 pr-9 text-left text-sm transition-colors',
                    'hover:border-sage/40 focus:outline-none focus:ring-2 focus:ring-sage/30',
                    // Reserve extra right padding when the clear button is visible
                    armedProduct && !triggerDisabled && 'pr-[4.5rem]',
                    triggerDisabled && 'cursor-not-allowed opacity-50',
                  )}
                />
              }
            >
              <span
                className={cn(
                  'truncate',
                  armedProduct ? 'text-charcoal' : 'text-mid/60',
                )}
              >
                {armedProduct ? armedProduct.name : 'Buscar produto...'}
              </span>
              <ChevronDown className="size-4 text-mid shrink-0" />
            </PopoverTrigger>
            <PopoverContent
              align="start"
              sideOffset={4}
              className="w-[min(420px,calc(100vw-2rem))] p-0"
            >
              <div className="flex items-center gap-2 border-b border-[#E8ECEF] px-3 py-2">
                <Search className="size-4 text-mid shrink-0" />
                <Input
                  ref={searchInputRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar produto..."
                  className="h-7 border-0 px-0 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  data-testid="armed-product-search"
                />
              </div>
              <div className="max-h-[320px] overflow-y-auto py-1" data-testid="armed-product-list">
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
                        const isArmed = p.id === armedProductId
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => handleSelect(p)}
                            data-testid={`armed-product-option-${p.id}`}
                            className={cn(
                              'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                              isArmed
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
                            {isArmed && <Check className="size-4 shrink-0 text-forest" />}
                          </button>
                        )
                      })}
                    </div>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
          {/* Clear button is a SIBLING of the trigger, positioned absolutely over it.
              This avoids the invalid "button inside a button" DOM that nesting would create. */}
          {armedProduct && !triggerDisabled && (
            <button
              type="button"
              onClick={handleClear}
              onMouseDown={(e) => e.stopPropagation()}
              data-testid="armed-product-clear"
              aria-label="Limpar produto selecionado"
              className="absolute right-8 top-1/2 -translate-y-1/2 flex size-5 items-center justify-center rounded-md text-mid hover:bg-[#F4F6F8] hover:text-charcoal"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      {!armedProduct && activeProducts.length > 0 && !disabled && (
        <p className="mt-1.5 text-[11px] text-mid">
          Selecione um produto para começar a marcar pontos.
        </p>
      )}
      {activeProducts.length === 0 && !disabled && (
        <p className="mt-1.5 text-[11px] text-mid">
          Configure produtos no catálogo para usar o diagrama.
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Write tests**

Create `web/src/components/face-diagram/__tests__/armed-product-strip.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArmedProductStrip } from '../armed-product-strip'
import type { CatalogProduct } from '../types'

const FIXTURE_PRODUCTS: CatalogProduct[] = [
  { id: 'p1', name: 'Botox Allergan 100U', category: 'botox', activeIngredient: 'Onabotulinumtoxin A', defaultUnit: 'U', isActive: true },
  { id: 'p2', name: 'Dysport 500U', category: 'botox', activeIngredient: 'Abobotulinumtoxin A', defaultUnit: 'U', isActive: true },
  { id: 'p3', name: 'Juvederm Voluma', category: 'filler', activeIngredient: 'Ácido Hialurônico', defaultUnit: 'mL', isActive: true },
  { id: 'p4', name: 'Sculptra', category: 'biostimulator', activeIngredient: 'Ácido Poli-L-Láctico', defaultUnit: 'mL', isActive: true },
  // Inactive — should never appear in the list
  { id: 'p5', name: 'Botox Discontinued', category: 'botox', activeIngredient: null, defaultUnit: 'U', isActive: false },
]

describe('ArmedProductStrip', () => {
  it('renders placeholder when no product is armed', () => {
    render(
      <ArmedProductStrip
        products={FIXTURE_PRODUCTS}
        armedProductId={null}
        onArmedProductIdChange={vi.fn()}
      />,
    )
    expect(screen.getByTestId('armed-product-trigger')).toHaveTextContent('Buscar produto...')
    expect(screen.getByText(/Selecione um produto para começar/i)).toBeInTheDocument()
  })

  it('renders the armed product name when one is selected', () => {
    render(
      <ArmedProductStrip
        products={FIXTURE_PRODUCTS}
        armedProductId="p1"
        onArmedProductIdChange={vi.fn()}
      />,
    )
    expect(screen.getByTestId('armed-product-trigger')).toHaveTextContent('Botox Allergan 100U')
    expect(screen.queryByText(/Selecione um produto para começar/i)).not.toBeInTheDocument()
  })

  it('shows empty-catalog message when no active products exist', () => {
    render(
      <ArmedProductStrip
        products={[]}
        armedProductId={null}
        onArmedProductIdChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/Configure produtos no catálogo/i)).toBeInTheDocument()
    // Trigger disabled attribute forwarded by Base UI via the `disabled` prop
    const trigger = screen.getByTestId('armed-product-trigger') as HTMLButtonElement
    expect(trigger).toBeDisabled()
  })

  it('shows empty-catalog message when all products are inactive', () => {
    render(
      <ArmedProductStrip
        products={[FIXTURE_PRODUCTS[4]]}
        armedProductId={null}
        onArmedProductIdChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/Configure produtos no catálogo/i)).toBeInTheDocument()
  })

  it('fires onArmedProductIdChange when a product is selected from the list', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ArmedProductStrip
        products={FIXTURE_PRODUCTS}
        armedProductId={null}
        onArmedProductIdChange={onChange}
      />,
    )
    await user.click(screen.getByTestId('armed-product-trigger'))
    const option = await screen.findByTestId('armed-product-option-p3')
    await user.click(option)
    expect(onChange).toHaveBeenCalledWith('p3')
  })

  it('filters by name via the search input', async () => {
    const user = userEvent.setup()
    render(
      <ArmedProductStrip
        products={FIXTURE_PRODUCTS}
        armedProductId={null}
        onArmedProductIdChange={vi.fn()}
      />,
    )
    await user.click(screen.getByTestId('armed-product-trigger'))
    const searchInput = await screen.findByTestId('armed-product-search')
    await user.click(searchInput)
    await user.keyboard('Juv')
    expect(screen.queryByTestId('armed-product-option-p1')).toBeNull()
    expect(screen.queryByTestId('armed-product-option-p2')).toBeNull()
    expect(await screen.findByTestId('armed-product-option-p3')).toBeInTheDocument()
    expect(screen.queryByTestId('armed-product-option-p4')).toBeNull()
  })

  it('excludes inactive products from the list', async () => {
    const user = userEvent.setup()
    render(
      <ArmedProductStrip
        products={FIXTURE_PRODUCTS}
        armedProductId={null}
        onArmedProductIdChange={vi.fn()}
      />,
    )
    await user.click(screen.getByTestId('armed-product-trigger'))
    await screen.findByTestId('armed-product-list')
    // p5 is inactive — must not appear
    expect(screen.queryByTestId('armed-product-option-p5')).toBeNull()
    // Active ones are still there
    expect(screen.getByTestId('armed-product-option-p1')).toBeInTheDocument()
  })

  it('shows "Nenhum produto encontrado" when the filter has no matches', async () => {
    const user = userEvent.setup()
    render(
      <ArmedProductStrip
        products={FIXTURE_PRODUCTS}
        armedProductId={null}
        onArmedProductIdChange={vi.fn()}
      />,
    )
    await user.click(screen.getByTestId('armed-product-trigger'))
    const searchInput = await screen.findByTestId('armed-product-search')
    await user.click(searchInput)
    await user.keyboard('zzzzz')
    expect(await screen.findByText('Nenhum produto encontrado')).toBeInTheDocument()
  })

  it('clears the armed product when the × button is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ArmedProductStrip
        products={FIXTURE_PRODUCTS}
        armedProductId="p1"
        onArmedProductIdChange={onChange}
      />,
    )
    await user.click(screen.getByTestId('armed-product-clear'))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('does not render the clear button when no product is armed', () => {
    render(
      <ArmedProductStrip
        products={FIXTURE_PRODUCTS}
        armedProductId={null}
        onArmedProductIdChange={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('armed-product-clear')).toBeNull()
  })
})
```

- [ ] **Step 3: Run the tests**

```
cd /Users/giorgiofellipe/Work/floraclin/web
PATH="/Users/giorgiofellipe/.local/share/fnm/node-versions/v22.12.0/installation/bin:/Users/giorgiofellipe/Library/pnpm:$PATH" pnpm exec vitest run armed-product-strip
```
Expected: PASS (10 tests).

- [ ] **Step 4: Typecheck**

```
PATH=... pnpm exec tsc --noEmit
```
Expected: PASS.

---

### Task A2: PointFormModal quantity input ref + initialFocus

**Files:**
- MODIFY: `web/src/components/face-diagram/point-form-modal.tsx`

**Context:** When a new point is dropped with a product already armed, `FaceDiagramEditor` passes `point.productName` / `activeIngredient` / `quantityUnit` in `editingPoint` (and `point.id` is undefined). The modal should focus the quantity input on open in that case.

Base UI's `DialogPopup` accepts an `initialFocus` prop (a `RefObject<HTMLElement>` or callback) that the `DialogContent` wrapper forwards via `...props`. Use it instead of the `setTimeout(focus)` pattern that races with the dialog's built-in focus management.

- [ ] **Step 1: Add a ref to the quantity Input**

Inside `PointFormModal`, near the existing `useState` declarations (after `const [showDetails, setShowDetails] = React.useState(...)`), add:

```tsx
const quantityInputRef = React.useRef<HTMLInputElement>(null)
```

- [ ] **Step 2: Attach the ref to the quantity Input**

Find the existing quantity `<Input>` (search for `id="quantity"`). Add `ref={quantityInputRef}` to its props:

```tsx
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
```

- [ ] **Step 3: Compute `shouldAutoFocusQuantity`**

Near the other derived values (e.g., `const isEditing = !!point.id` at the top of the component body), add:

```tsx
// Auto-focus the quantity input for new points that already have a
// pre-filled product (armed-product quick-entry flow). Editing an existing
// point falls back to Base UI's default focus management.
const shouldAutoFocusQuantity = !point.id && !!point.productName
```

- [ ] **Step 4: Pass `initialFocus` to `DialogContent`**

Find the existing `<DialogContent className="sm:max-w-md">` line near the return statement. Change to:

```tsx
<DialogContent
  className="sm:max-w-md"
  initialFocus={shouldAutoFocusQuantity ? quantityInputRef : undefined}
>
```

`DialogContent` already forwards unknown props to `DialogPrimitive.Popup` via `{...props}` (see `web/src/components/ui/dialog.tsx:59`), so no change to the dialog wrapper is needed.

- [ ] **Step 5: Typecheck**

```
PATH=... pnpm exec tsc --noEmit
```
Expected: PASS. If there's a type complaint that `initialFocus` isn't on `DialogContentProps`, note it and wrap as `{...({ initialFocus: ... } as unknown as { initialFocus: never })}` as a last resort — but the first pass should try passing the prop directly.

- [ ] **Step 6: Sanity-run face-diagram tests**

```
PATH=... pnpm exec vitest run face-diagram
```
Expected: existing face-diagram tests still pass.

---

## Group B — FaceDiagramEditor integration

### Task B1: Wire armed-product state into FaceDiagramEditor

**Files:**
- MODIFY: `web/src/components/face-diagram/face-diagram-editor.tsx`

**Depends on:** Task A1 must be complete.

- [ ] **Step 1: Add imports**

At the top of `face-diagram-editor.tsx`, add:

```tsx
import { ArmedProductStrip } from './armed-product-strip'
```

- [ ] **Step 2: Add armed-product state**

Inside the `FaceDiagramEditor` component, near the existing `useState` calls (after `editingPoint`), add:

```tsx
const [armedProductId, setArmedProductId] = React.useState<string | null>(null)

const armedProduct = React.useMemo(
  () => products?.find((p) => p.id === armedProductId && p.isActive) ?? null,
  [products, armedProductId],
)
```

- [ ] **Step 3: Rewrite `handleFaceClick` to pre-fill from armed product**

Replace the existing `handleFaceClick`:

```tsx
function handleFaceClick(e: React.MouseEvent<HTMLDivElement>) {
  if (readOnly) return
  if (!products || products.length === 0) return

  const rect = e.currentTarget.getBoundingClientRect()
  const x = ((e.clientX - rect.left) / rect.width) * 100
  const y = ((e.clientY - rect.top) / rect.height) * 100

  const clampedX = Math.max(0, Math.min(100, x))
  const clampedY = Math.max(0, Math.min(100, y))

  const basePoint: Partial<DiagramPointData> & { x: number; y: number } = {
    x: Math.round(clampedX * 100) / 100,
    y: Math.round(clampedY * 100) / 100,
    viewType: activeView,
  }

  // If a product is armed, pre-fill identity fields so the modal opens
  // straight to a focused quantity input.
  if (armedProduct) {
    basePoint.productName = armedProduct.name
    basePoint.activeIngredient = armedProduct.activeIngredient ?? undefined
    // Defensive: only pre-fill the unit if it's one of the valid enum values.
    // Catalog products may have other strings in defaultUnit that would
    // corrupt the pre-fill otherwise.
    if (armedProduct.defaultUnit === 'U' || armedProduct.defaultUnit === 'mL') {
      basePoint.quantityUnit = armedProduct.defaultUnit
    }
  }

  setEditingPoint(basePoint)
  setModalOpen(true)
}
```

- [ ] **Step 4: Render `<ArmedProductStrip>`**

Find the JSX block that ends the view-switcher row — search for the closing `</div>` right after the `{/* Previous toggle */}` block. Immediately after that closing `</div>` and BEFORE the `{/* ─── Canvas + summary ──────────────────────── */}` comment, insert:

```tsx
{!readOnly && (
  <ArmedProductStrip
    products={products ?? []}
    armedProductId={armedProductId}
    onArmedProductIdChange={setArmedProductId}
  />
)}
```

- [ ] **Step 5: Update the canvas empty-state helper**

Find the block rendering the empty-state hint (`{points.filter(...).length === 0 && !readOnly && (...)}`). Replace the inner `<span>` content with:

```tsx
{(!products || products.length === 0)
  ? 'Configure produtos para usar o diagrama'
  : armedProduct
    ? 'Clique para adicionar ponto'
    : 'Selecione um produto acima para marcar pontos'
}
```

- [ ] **Step 6: Typecheck**

```
PATH=... pnpm exec tsc --noEmit
```
Expected: PASS.

- [ ] **Step 7: Run face-diagram tests**

```
PATH=... pnpm exec vitest run face-diagram
```
Expected: existing face-diagram tests pass + new armed-product-strip tests pass (10 tests).

- [ ] **Step 8: Run the full suite**

```
PATH=... pnpm exec vitest run
```
Expected: full suite green (previously 534, now 544 with 10 new tests).

---

## Pre-merge checks

- [ ] `pnpm exec tsc --noEmit` — PASS
- [ ] `pnpm exec vitest run` — PASS
- [ ] `pnpm exec eslint src/components/face-diagram` — 0 errors
- [ ] **Manual smoke test** on dev server:
  1. Navigate to a patient → atendimento → step 3 (Planejamento)
  2. Verify the "Produto" strip is visible above the face canvas
  3. Click the trigger → popover opens → search input is focused
  4. Type "bot" → only botox products show
  5. Click a product → popover closes → trigger shows the product name
  6. Click on the face → modal opens with product pre-filled + unit set + quantity empty and **focused** (not just tab-reachable)
  7. Type `2` and press Enter → point drops, modal closes
  8. Click again on a different spot → same quick flow → type `3` → Enter → placed
  9. Click the × on the strip → armed product clears → placeholder returns
  10. Click on the face (no armed product) → modal opens empty (cold-entry path)
  11. Click an existing placed point → modal opens with all data; quantity field is NOT auto-focused (default dialog focus instead)
  12. Set a product whose `defaultUnit` is neither `U` nor `mL` (if any exists) → click on face → modal opens with product pre-filled, unit toggle unchanged (falls back to default)
- [ ] **Await user approval before committing**

## Out of scope (future work)

- **Duplicate product names** — pre-existing issue: `PointFormModal` matches catalog entries by `name`. If two active products share a name, editing a previously placed point may resolve to the wrong one. Should be fixed by storing `catalogProductId` on `DiagramPointData`, but that's a schema change and separate from this spec.
- **Keyboard nav in the popover list** — arrow keys / Enter / Escape. Click-only for v1; add later if users complain.
- **Per-product quantity memory** — explicitly rejected by user (medical-safety intent: always make the dose a conscious entry).
