# Onboarding Products Step — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the US/Europe-centric default product catalog with a Brazilian-market-curated list and add a new onboarding step where owners select which defaults to seed and add custom products.

**Architecture:** Update `DEFAULT_PRODUCTS` constant with 12 Brazilian-focused entries + `origin` field. Create a `CustomProductForm` component and a `ProductsStep` component (extracted as its own file for clarity since logic is non-trivial). Add a `validations/onboarding.ts` zod schema for the payload. Extend the onboarding API route to read `selectedProducts` from the payload and seed from that instead of blindly iterating `DEFAULT_PRODUCTS`. Wire the new step into `onboarding-wizard.tsx` between Procedures and Team.

**Tech Stack:** React 19, TypeScript, zod, lucide-react, @base-ui-components/react, Vitest + @testing-library/react

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `web/src/lib/constants.ts` | Modify | Replace `DEFAULT_PRODUCTS` with Brazilian-curated 12-entry list, add `origin` field |
| `web/src/validations/onboarding.ts` | Create | Zod schemas for onboarding payload + `productSelectionSchema` |
| `web/src/components/onboarding/custom-product-form.tsx` | Create | Inline form for adding a single custom product |
| `web/src/components/onboarding/products-step.tsx` | Create | Product selection step UI (grouped by category, checkbox cards, custom form trigger) |
| `web/src/app/api/onboarding/route.ts` | Modify | Accept `selectedProducts` in payload, seed from it instead of blind `DEFAULT_PRODUCTS` iteration |
| `web/src/app/onboarding/page.tsx` | Modify | Load `existingProducts` and pass to wizard (analogous to existing `existingProcedureTypes`) |
| `web/src/components/onboarding/onboarding-wizard.tsx` | Modify | Insert Products step between Procedures and Team, extend state + submission; show "products already configured" notice when `existingProducts.length > 0` |
| `web/src/lib/__tests__/constants.test.ts` | Create | Tests for `DEFAULT_PRODUCTS` shape and origin values |
| `web/src/validations/__tests__/onboarding.test.ts` | Create | Tests for onboarding zod schemas |
| `web/src/components/onboarding/__tests__/custom-product-form.test.tsx` | Create | Tests for custom product form |
| `web/src/components/onboarding/__tests__/products-step.test.tsx` | Create | Tests for products step (pre-selection, toggle, custom add/remove, submission shape) |

---

## Parallelization Summary

```
Group A: Task 1 (constants) + Task 2 (validation schema) + Task 3 (custom-product-form)
          — all independent, different files
Group B: Task 4 (products-step)                  — depends on A (constants, custom form)
Group C: Task 5 (API route) + Task 6 (wizard)    — depends on B
          — parallel, different files
```

---

## Group A (parallel) — Foundation

### Task 1: Update DEFAULT_PRODUCTS with Brazilian catalog

**Files:**
- Modify: `web/src/lib/constants.ts`
- Create: `web/src/lib/__tests__/constants.test.ts`

- [ ] **Step 1: Write the test**

```ts
// web/src/lib/__tests__/constants.test.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_PRODUCTS } from '../constants'

describe('DEFAULT_PRODUCTS', () => {
  it('contains 12 curated Brazilian-market products', () => {
    expect(DEFAULT_PRODUCTS).toHaveLength(12)
  })

  it('every product has required fields including origin', () => {
    for (const p of DEFAULT_PRODUCTS) {
      expect(p.name).toBeTruthy()
      expect(p.category).toBeTruthy()
      expect(p.activeIngredient).toBeTruthy()
      expect(p.defaultUnit).toBeTruthy()
      expect(['nacional', 'importado']).toContain(p.origin)
    }
  })

  it('includes the four expected categories', () => {
    const cats = new Set(DEFAULT_PRODUCTS.map((p) => p.category))
    expect(cats).toEqual(new Set(['botox', 'filler', 'biostimulator', 'skinbooster']))
  })

  it('includes the expected Brazilian-origin products', () => {
    const nacionais = DEFAULT_PRODUCTS.filter((p) => p.origin === 'nacional').map((p) => p.name)
    expect(nacionais).toContain('Botulift 100U')
    expect(nacionais).toContain('Biogelis')
    expect(nacionais).toContain('Rennova Elleva')
  })

  it('includes the expected imported staples', () => {
    const names = DEFAULT_PRODUCTS.map((p) => p.name)
    expect(names).toContain('Botox Allergan 100U')
    expect(names).toContain('Dysport 300U')
    expect(names).toContain('Sculptra')
    expect(names).toContain('Profhilo')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
cd /Users/giorgiofellipe/Work/floraclin && eval "$(fnm env)" && fnm use 22.12.0 >/dev/null && pnpm --filter web test:run -- --reporter=verbose web/src/lib/__tests__/constants.test.ts
```
Expected: FAIL (length still 12 but missing `origin` field, or will fail strict equality)

- [ ] **Step 3: Update `DEFAULT_PRODUCTS` in `web/src/lib/constants.ts`**

Replace the current `DEFAULT_PRODUCTS` export with:

```ts
export const DEFAULT_PRODUCTS = [
  // Toxinas botulínicas
  { name: 'Botox Allergan 100U', category: 'botox', activeIngredient: 'Toxina botulínica tipo A', defaultUnit: 'U', origin: 'importado' },
  { name: 'Dysport 300U', category: 'botox', activeIngredient: 'Toxina botulínica tipo A', defaultUnit: 'U', origin: 'importado' },
  { name: 'Botulift 100U', category: 'botox', activeIngredient: 'Toxina botulínica tipo A', defaultUnit: 'U', origin: 'nacional' },
  // Preenchedores
  { name: 'Juvederm Ultra XC', category: 'filler', activeIngredient: 'Ácido hialurônico', defaultUnit: 'mL', origin: 'importado' },
  { name: 'Juvederm Voluma XC', category: 'filler', activeIngredient: 'Ácido hialurônico', defaultUnit: 'mL', origin: 'importado' },
  { name: 'Restylane Lyft', category: 'filler', activeIngredient: 'Ácido hialurônico', defaultUnit: 'mL', origin: 'importado' },
  { name: 'Biogelis', category: 'filler', activeIngredient: 'Ácido hialurônico', defaultUnit: 'mL', origin: 'nacional' },
  // Bioestimuladores
  { name: 'Sculptra', category: 'biostimulator', activeIngredient: 'Ácido poli-L-láctico', defaultUnit: 'mL', origin: 'importado' },
  { name: 'Rennova Elleva', category: 'biostimulator', activeIngredient: 'Ácido poli-L-láctico', defaultUnit: 'mL', origin: 'nacional' },
  { name: 'Radiesse', category: 'biostimulator', activeIngredient: 'Hidroxiapatita de cálcio', defaultUnit: 'mL', origin: 'importado' },
  // Skinboosters
  { name: 'Restylane Skinbooster Vital', category: 'skinbooster', activeIngredient: 'Ácido hialurônico', defaultUnit: 'mL', origin: 'importado' },
  { name: 'Profhilo', category: 'skinbooster', activeIngredient: 'Ácido hialurônico híbrido', defaultUnit: 'mL', origin: 'importado' },
] as const

export type DefaultProductOrigin = 'nacional' | 'importado'
```

- [ ] **Step 4: Run test to verify it passes**

```
pnpm --filter web test:run -- --reporter=verbose web/src/lib/__tests__/constants.test.ts
```
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/constants.ts web/src/lib/__tests__/constants.test.ts
git commit -m "chore: update DEFAULT_PRODUCTS to Brazilian HOF 2025 catalog"
```

---

### Task 2: Onboarding validation schema

**Files:**
- Create: `web/src/validations/onboarding.ts`
- Create: `web/src/validations/__tests__/onboarding.test.ts`
- Modify: `web/src/validations/tenant.ts` (export `addressSchema` if not already exported)
- Modify: `web/src/lib/constants.ts` (export `PROCEDURE_CATEGORIES` if not already exported)

- [ ] **Step 0: Verify exports exist**

Check `web/src/validations/tenant.ts`: if `addressSchema` and `workingHoursSchema` aren't already `export`ed, add `export` to their declarations.

Check `web/src/lib/constants.ts`: if `PROCEDURE_CATEGORIES` isn't already `export`ed, add `export` to it. (Task 1 didn't touch it — this is a separate one-word change.)

- [ ] **Step 1: Write the test**

```ts
// web/src/validations/__tests__/onboarding.test.ts
import { describe, it, expect } from 'vitest'
import { productSelectionSchema, onboardingCompleteSchema } from '../onboarding'

describe('productSelectionSchema', () => {
  it('accepts a minimal valid product', () => {
    const result = productSelectionSchema.safeParse({
      name: 'Botulift 100U',
      category: 'botox',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.defaultUnit).toBe('U')
      expect(result.data.activeIngredient).toBe('')
    }
  })

  it('rejects empty name', () => {
    const result = productSelectionSchema.safeParse({ name: '', category: 'botox' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid category', () => {
    const result = productSelectionSchema.safeParse({ name: 'Foo', category: 'invalid' })
    expect(result.success).toBe(false)
  })

  it('accepts all valid categories', () => {
    for (const cat of ['botox', 'filler', 'biostimulator', 'skinbooster', 'peel', 'other']) {
      const result = productSelectionSchema.safeParse({ name: 'X', category: cat })
      expect(result.success).toBe(true)
    }
  })

  it('accepts both U and mL units', () => {
    for (const unit of ['U', 'mL']) {
      const result = productSelectionSchema.safeParse({
        name: 'X',
        category: 'botox',
        defaultUnit: unit,
      })
      expect(result.success).toBe(true)
    }
  })
})

describe('onboardingCompleteSchema', () => {
  it('accepts empty selectedProducts array', () => {
    const result = onboardingCompleteSchema.safeParse({
      clinic: { name: 'Clínica X', workingHours: {} },
      procedureTypes: [],
      selectedProducts: [],
    })
    expect(result.success).toBe(true)
  })

  it('defaults selectedProducts to empty when omitted', () => {
    const result = onboardingCompleteSchema.safeParse({
      clinic: { name: 'Clínica X', workingHours: {} },
      procedureTypes: [],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.selectedProducts).toEqual([])
  })

  it('accepts valid selectedProducts', () => {
    const result = onboardingCompleteSchema.safeParse({
      clinic: { name: 'Clínica X', workingHours: {} },
      procedureTypes: [],
      selectedProducts: [
        { name: 'Botulift 100U', category: 'botox', activeIngredient: 'Toxina', defaultUnit: 'U' },
      ],
    })
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm --filter web test:run -- --reporter=verbose web/src/validations/__tests__/onboarding.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create the schema file**

```ts
// web/src/validations/onboarding.ts
import { z } from 'zod'
import { addressSchema, workingHoursSchema } from './tenant'
import { PROCEDURE_CATEGORIES } from '@/lib/constants'

// Product categories accepted in onboarding — superset of PROCEDURE_CATEGORIES
// used for custom products that might not map 1:1 to a procedure type
const PRODUCT_CATEGORIES = ['botox', 'filler', 'biostimulator', 'skinbooster', 'peel', 'other'] as const

export const productSelectionSchema = z.object({
  name: z.string().min(1, 'Nome do produto é obrigatório').max(150),
  category: z.enum(PRODUCT_CATEGORIES),
  activeIngredient: z.string().max(150).optional().default(''),
  defaultUnit: z.enum(['U', 'mL']).default('U'),
})

export type ProductSelection = z.infer<typeof productSelectionSchema>

const clinicDataSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: addressSchema.optional(),
  workingHours: workingHoursSchema,
})

const procedureTypeInputSchema = z.object({
  name: z.string().min(1),
  category: z.enum(PROCEDURE_CATEGORIES),
  estimatedDurationMin: z.number().int().min(5).max(480).optional(),
  defaultPrice: z.string().optional(),
})

export const onboardingCompleteSchema = z.object({
  clinic: clinicDataSchema,
  procedureTypes: z.array(procedureTypeInputSchema).default([]),
  selectedProducts: z.array(productSelectionSchema).default([]),
})

export type OnboardingCompleteInput = z.infer<typeof onboardingCompleteSchema>
```

**Note:** `addressSchema`, `workingHoursSchema`, and `PROCEDURE_CATEGORIES` already exist. If `addressSchema` isn't exported from `@/validations/tenant`, add an export there as a small prereq. If `PROCEDURE_CATEGORIES` isn't exported from `@/lib/constants`, add an export there as well.

- [ ] **Step 4: Run test to verify it passes**

```
pnpm --filter web test:run -- --reporter=verbose web/src/validations/__tests__/onboarding.test.ts
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/validations/onboarding.ts web/src/validations/__tests__/onboarding.test.ts
git commit -m "feat: add onboarding zod schemas with productSelectionSchema"
```

---

### Task 3: CustomProductForm component

**Files:**
- Create: `web/src/components/onboarding/custom-product-form.tsx`
- Create: `web/src/components/onboarding/__tests__/custom-product-form.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// web/src/components/onboarding/__tests__/custom-product-form.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CustomProductForm } from '../custom-product-form'

describe('CustomProductForm', () => {
  it('renders all fields', () => {
    render(<CustomProductForm onAdd={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByPlaceholderText('Nome do produto')).toBeInTheDocument()
    expect(screen.getByText('Adicionar')).toBeInTheDocument()
    expect(screen.getByText('Cancelar')).toBeInTheDocument()
  })

  it('disables Adicionar when name is empty', () => {
    render(<CustomProductForm onAdd={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Adicionar' })).toBeDisabled()
  })

  it('calls onAdd with product data when submitted', async () => {
    const onAdd = vi.fn()
    render(<CustomProductForm onAdd={onAdd} onCancel={vi.fn()} />)

    await userEvent.type(screen.getByPlaceholderText('Nome do produto'), 'Custom Toxin')
    await userEvent.type(screen.getByPlaceholderText('Princípio ativo (opcional)'), 'Toxina X')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }))

    expect(onAdd).toHaveBeenCalledWith({
      name: 'Custom Toxin',
      category: 'botox',
      activeIngredient: 'Toxina X',
      defaultUnit: 'U',
    })
  })

  it('calls onCancel when Cancelar is clicked', async () => {
    const onCancel = vi.fn()
    render(<CustomProductForm onAdd={vi.fn()} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm --filter web test:run -- --reporter=verbose web/src/components/onboarding/__tests__/custom-product-form.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

```tsx
// web/src/components/onboarding/custom-product-form.tsx
'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface CustomProductInput {
  name: string
  category: 'botox' | 'filler' | 'biostimulator' | 'skinbooster' | 'peel' | 'other'
  activeIngredient: string
  defaultUnit: 'U' | 'mL'
}

interface CustomProductFormProps {
  onAdd: (product: CustomProductInput) => void
  onCancel: () => void
}

const CATEGORY_ITEMS: Record<string, string> = {
  botox: 'Toxina Botulínica',
  filler: 'Preenchedor',
  biostimulator: 'Bioestimulador',
  skinbooster: 'Skinbooster',
  peel: 'Peeling',
  other: 'Outro',
}

const UNIT_ITEMS: Record<string, string> = { U: 'U (Unidades)', mL: 'mL (Mililitros)' }

export function CustomProductForm({ onAdd, onCancel }: CustomProductFormProps) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<CustomProductInput['category']>('botox')
  const [activeIngredient, setActiveIngredient] = useState('')
  const [defaultUnit, setDefaultUnit] = useState<CustomProductInput['defaultUnit']>('U')

  function handleAdd() {
    const trimmed = name.trim()
    if (!trimmed) return
    onAdd({
      name: trimmed,
      category,
      activeIngredient: activeIngredient.trim(),
      defaultUnit,
    })
    setName('')
    setActiveIngredient('')
    setCategory('botox')
    setDefaultUnit('U')
  }

  return (
    <div className="rounded-lg border border-[#E8ECEF] bg-[#F4F6F8] p-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="uppercase tracking-wider text-xs font-medium text-mid">Nome</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do produto"
            maxLength={150}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label className="uppercase tracking-wider text-xs font-medium text-mid">Categoria</Label>
          <Select
            items={CATEGORY_ITEMS}
            value={category}
            onValueChange={(v) => v && setCategory(v as CustomProductInput['category'])}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CATEGORY_ITEMS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="uppercase tracking-wider text-xs font-medium text-mid">Unidade</Label>
          <Select
            items={UNIT_ITEMS}
            value={defaultUnit}
            onValueChange={(v) => v && setDefaultUnit(v as CustomProductInput['defaultUnit'])}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(UNIT_ITEMS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="uppercase tracking-wider text-xs font-medium text-mid">Princípio ativo</Label>
          <Input
            value={activeIngredient}
            onChange={(e) => setActiveIngredient(e.target.value)}
            placeholder="Princípio ativo (opcional)"
            maxLength={150}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="button" size="sm" onClick={handleAdd} disabled={!name.trim()}>
          Adicionar
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```
pnpm --filter web test:run -- --reporter=verbose web/src/components/onboarding/__tests__/custom-product-form.test.tsx
```
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/onboarding/custom-product-form.tsx web/src/components/onboarding/__tests__/custom-product-form.test.tsx
git commit -m "feat: onboarding CustomProductForm component"
```

---

## Group B (depends on A) — Products Step UI

### Task 4: ProductsStep component

**Files:**
- Create: `web/src/components/onboarding/products-step.tsx`
- Create: `web/src/components/onboarding/__tests__/products-step.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// web/src/components/onboarding/__tests__/products-step.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductsStep, type ProductStepItem } from '../products-step'

describe('ProductsStep', () => {
  const baseProps = {
    selectedNames: new Set<string>(),
    customProducts: [] as ProductStepItem[],
    onSelectionChange: vi.fn(),
    onAddCustom: vi.fn(),
    onRemoveCustom: vi.fn(),
  }

  it('renders all 12 default products grouped by category', () => {
    render(<ProductsStep {...baseProps} />)
    // Category headers
    expect(screen.getByText('Toxina Botulínica')).toBeInTheDocument()
    expect(screen.getByText('Preenchedores')).toBeInTheDocument()
    expect(screen.getByText('Bioestimuladores')).toBeInTheDocument()
    expect(screen.getByText('Skinboosters')).toBeInTheDocument()
    // Sample product
    expect(screen.getByText('Botulift 100U')).toBeInTheDocument()
    expect(screen.getByText('Sculptra')).toBeInTheDocument()
  })

  it('marks pre-selected products as checked', () => {
    const selectedNames = new Set(['Botox Allergan 100U', 'Sculptra'])
    render(<ProductsStep {...baseProps} selectedNames={selectedNames} />)
    // Base UI Checkbox renders role='checkbox' via its internal button.
    // Use role+name query so we interact with the visible control, not the hidden input.
    const botox = screen.getByRole('checkbox', { name: 'Botox Allergan 100U' })
    const sculptra = screen.getByRole('checkbox', { name: 'Sculptra' })
    expect(botox.getAttribute('aria-checked')).toBe('true')
    expect(sculptra.getAttribute('aria-checked')).toBe('true')
  })

  it('calls onSelectionChange when a default product is toggled', async () => {
    const onSelectionChange = vi.fn()
    render(<ProductsStep {...baseProps} onSelectionChange={onSelectionChange} />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Botulift 100U' }))
    expect(onSelectionChange).toHaveBeenCalledWith('Botulift 100U', true)
  })

  it('shows Brazilian badge for nacional products', () => {
    render(<ProductsStep {...baseProps} />)
    // Botulift is nacional — should have a BR badge nearby
    const botuliftRow = screen.getByText('Botulift 100U').closest('[data-product-row]')
    expect(botuliftRow).toBeTruthy()
    expect(botuliftRow?.textContent).toContain('Nacional')
  })

  it('renders custom products', () => {
    const customProducts: ProductStepItem[] = [
      { name: 'My Custom', category: 'botox', activeIngredient: '', defaultUnit: 'U', isCustom: true },
    ]
    render(<ProductsStep {...baseProps} customProducts={customProducts} />)
    expect(screen.getByText('My Custom')).toBeInTheDocument()
  })

  it('opens the custom form when Adicionar produto personalizado is clicked', async () => {
    render(<ProductsStep {...baseProps} />)
    await userEvent.click(screen.getByRole('button', { name: /Adicionar produto personalizado/ }))
    expect(screen.getByPlaceholderText('Nome do produto')).toBeInTheDocument()
  })

  it('calls onRemoveCustom when removing a custom product', async () => {
    const onRemoveCustom = vi.fn()
    const customProducts: ProductStepItem[] = [
      { name: 'My Custom', category: 'botox', activeIngredient: '', defaultUnit: 'U', isCustom: true },
    ]
    render(
      <ProductsStep {...baseProps} customProducts={customProducts} onRemoveCustom={onRemoveCustom} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Remover My Custom/ }))
    expect(onRemoveCustom).toHaveBeenCalledWith('My Custom')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm --filter web test:run -- --reporter=verbose web/src/components/onboarding/__tests__/products-step.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

```tsx
// web/src/components/onboarding/products-step.tsx
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

  // Render all categories the custom form can produce, so a custom 'peel' or
  // 'other' never gets silently dropped.
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
```

- [ ] **Step 4: Run test to verify it passes**

```
pnpm --filter web test:run -- --reporter=verbose web/src/components/onboarding/__tests__/products-step.test.tsx
```
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/onboarding/products-step.tsx web/src/components/onboarding/__tests__/products-step.test.tsx
git commit -m "feat: onboarding ProductsStep with grouped default selection + custom add"
```

---

## Group C (depends on B) — Integration (parallel)

### Task 5: Update API route seeding logic

**Files:**
- Modify: `web/src/app/api/onboarding/route.ts`

- [ ] **Step 1: Extend `OnboardingData` interface and import validation**

At the top of the file, import:
```ts
import { onboardingCompleteSchema } from '@/validations/onboarding'
```

Add to the `OnboardingData` interface (or replace TS interface with the zod-inferred type):
```ts
selectedProducts?: Array<{
  name: string
  category: string
  activeIngredient?: string
  defaultUnit?: string
}>
```

- [ ] **Step 2: Validate the payload and read `selectedProducts`**

At the start of the POST handler, after parsing the JSON body, run:

```ts
const parsed = onboardingCompleteSchema.safeParse(body)
if (!parsed.success) {
  return NextResponse.json(
    { error: 'Dados de onboarding inválidos', issues: parsed.error.flatten() },
    { status: 400 },
  )
}
const data = parsed.data
```

Replace all downstream references that previously used `body` with `data`.

- [ ] **Step 3: Replace product seeding logic**

Locate the block that iterates `DEFAULT_PRODUCTS` and replace with:

```ts
// Seed only selected products (user-curated via onboarding step)
if (existingProducts.length === 0 && data.selectedProducts.length > 0) {
  for (const p of data.selectedProducts) {
    await createProduct(tenantId, {
      name: p.name,
      category: p.category,
      activeIngredient: p.activeIngredient || undefined,
      defaultUnit: p.defaultUnit || 'U',
    })
  }
}
```

Remove any remaining direct import/iteration of `DEFAULT_PRODUCTS` in this file.

- [ ] **Step 4: Run existing tests**

```
pnpm --filter web test:run
```
Expected: all tests pass. (No test file for the API route exists; integration is exercised via other tests.)

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/onboarding/route.ts
git commit -m "feat: onboarding API seeds selected products from payload"
```

---

### Task 6: Wire new step into OnboardingWizard

**Files:**
- Modify: `web/src/components/onboarding/onboarding-wizard.tsx`

- [ ] **Step 0: Update `web/src/app/onboarding/page.tsx` to load existing products**

Before rendering `<OnboardingWizard>`, add a query for existing products (analogous to `existingProcedureTypes`):

```tsx
const existingProducts = await listProducts(tenantId)
// ...pass to the wizard as a new prop:
<OnboardingWizard existingProducts={existingProducts} existingProcedureTypes={existingProcedureTypes} />
```

Extend `OnboardingWizardProps` in `onboarding-wizard.tsx` to accept `existingProducts`.

- [ ] **Step 1: Add state for selected products and custom products**

Inside the `OnboardingWizard` component, alongside the existing state hooks:

```tsx
import { toast } from 'sonner'
import { DEFAULT_PRODUCTS } from '@/lib/constants'
import { ProductsStep, type ProductStepItem } from './products-step'
import type { CustomProductInput } from './custom-product-form'

// alreadyConfigured derives from the prop
const productsAlreadyConfigured = (existingProducts?.length ?? 0) > 0

const [selectedProductNames, setSelectedProductNames] = useState<Set<string>>(
  () => new Set(DEFAULT_PRODUCTS.map((p) => p.name)),
)
const [customProducts, setCustomProducts] = useState<ProductStepItem[]>([])

function handleProductSelectionChange(name: string, selected: boolean) {
  setSelectedProductNames((prev) => {
    const next = new Set(prev)
    if (selected) next.add(name)
    else next.delete(name)
    return next
  })
}

function handleAddCustomProduct(product: CustomProductInput) {
  // Guard against duplicate names (against both defaults and existing customs).
  const nameLower = product.name.trim().toLowerCase()
  const collidesWithDefault = DEFAULT_PRODUCTS.some((d) => d.name.toLowerCase() === nameLower)
  setCustomProducts((prev) => {
    const collidesWithCustom = prev.some((p) => p.name.toLowerCase() === nameLower)
    if (collidesWithDefault || collidesWithCustom) {
      toast.error(`Já existe um produto chamado "${product.name}"`)
      return prev
    }
    return [...prev, { ...product, isCustom: true }]
  })
}

function handleRemoveCustomProduct(name: string) {
  setCustomProducts((prev) => prev.filter((p) => p.name !== name))
}
```

- [ ] **Step 2: Insert the Products step between Procedures and Team**

Find the step rendering (currently step 1 = Clínica, step 2 = Procedimentos, step 3 = Equipe). Change the step count to 4 and renumber. Insert between current steps 2 and 3:

```tsx
{currentStep === 3 && (
  <ProductsStep
    selectedNames={selectedProductNames}
    customProducts={customProducts}
    alreadyConfigured={productsAlreadyConfigured}
    onSelectionChange={handleProductSelectionChange}
    onAddCustom={handleAddCustomProduct}
    onRemoveCustom={handleRemoveCustomProduct}
  />
)}
```

Update the existing Team rendering from `currentStep === 3` to `currentStep === 4`.

Update the step indicator/progress bar logic so that it reflects 4 steps (e.g., `totalSteps = 4`, step labels include "Produtos"). Locate the existing step label array and insert `'Produtos'` at index 2.

- [ ] **Step 3: Include selectedProducts in the submission payload**

Find the POST to `/api/onboarding` and extend the body:

```tsx
// Note: DEFAULT_PRODUCTS has an 'origin' field — UI-only. Strip it before
// sending. Custom products don't have 'origin'. Strip 'isCustom' too — the
// API doesn't need it.
const selectedProducts = [
  ...DEFAULT_PRODUCTS.filter((p) => selectedProductNames.has(p.name)).map((p) => ({
    name: p.name,
    category: p.category,
    activeIngredient: p.activeIngredient,
    defaultUnit: p.defaultUnit,
  })),
  ...customProducts.map((p) => ({
    name: p.name,
    category: p.category,
    activeIngredient: p.activeIngredient,
    defaultUnit: p.defaultUnit,
  })),
]

const body = {
  clinic: clinicData,
  procedureTypes: /* existing filtered procedure types */,
  selectedProducts,
}
```

- [ ] **Step 4: Add integration test for wizard**

Create `web/src/components/onboarding/__tests__/onboarding-wizard.test.tsx` with at minimum:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OnboardingWizard } from '../onboarding-wizard'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const fetchMock = vi.fn()
global.fetch = fetchMock as unknown as typeof fetch

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

describe('OnboardingWizard integration', () => {
  it('renders 4 steps and sends selectedProducts in the final POST', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    render(wrap(<OnboardingWizard existingProcedureTypes={[]} existingProducts={[]} />))

    // Step 1 — Clínica: fill name and advance
    await userEvent.type(screen.getByLabelText(/nome.*clínica/i), 'Clínica X')
    await userEvent.click(screen.getByRole('button', { name: /próximo|continuar/i }))

    // Step 2 — Procedimentos
    await userEvent.click(screen.getByRole('button', { name: /próximo|continuar/i }))

    // Step 3 — Produtos: should be visible
    expect(screen.getByText('Produtos')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /próximo|continuar/i }))

    // Step 4 — Equipe (skip straight to complete)
    await userEvent.click(screen.getByRole('button', { name: /concluir|finalizar/i }))

    // Assert the POST body carries selectedProducts
    expect(fetchMock).toHaveBeenCalled()
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/onboarding'))
    expect(call).toBeTruthy()
    const body = JSON.parse(call![1].body as string)
    expect(Array.isArray(body.selectedProducts)).toBe(true)
    expect(body.selectedProducts.length).toBeGreaterThan(0)
    // origin must not be forwarded
    for (const p of body.selectedProducts) {
      expect(p).not.toHaveProperty('origin')
      expect(p).not.toHaveProperty('isCustom')
    }
  })
})
```

Adjust button label regexes to match the actual wizard copy after inspecting the source.

- [ ] **Step 5: Run the full test suite**

```
pnpm --filter web test:run
```
Expected: all tests pass.

- [ ] **Step 6: Typecheck**

```
cd /Users/giorgiofellipe/Work/floraclin/web && eval "$(fnm env)" && fnm use 22.12.0 >/dev/null && npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add web/src/app/onboarding/page.tsx web/src/components/onboarding/onboarding-wizard.tsx web/src/components/onboarding/__tests__/onboarding-wizard.test.tsx
git commit -m "feat: onboarding wizard — 4 steps with Produtos between Procedimentos and Equipe"
```

---

## Self-Review Notes

- **Spec coverage:** Every change in the spec has a task. The curated default list → Task 1. `productSelectionSchema` → Task 2. Custom form → Task 3. Products step → Task 4. API seeding → Task 5. Wizard integration → Task 6.
- **Parallelization:** Group A tasks touch `constants.ts`, `validations/onboarding.ts`, `custom-product-form.tsx` — no overlap. Group B has only Task 4 (depends on Tasks 1 and 3). Group C has Task 5 (`route.ts`) and Task 6 (`onboarding-wizard.tsx`) — no file overlap, parallel.
- **Type consistency:** `ProductStepItem`, `CustomProductInput`, `ProductSelection` are used consistently. The wizard converts between them at the boundary (maps `ProductStepItem[]` → the API payload shape).
- **Placeholder scan:** No TBD, TODO, or fill-in-later. Commands and code are explicit.
