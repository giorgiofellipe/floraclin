# Expense Category UX Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow inline category creation from the expense form, rework the icon picker to a compact grid with 28 clinic-relevant icons, and unify icon definitions into a single source of truth.

**Architecture:** Create a unified icon registry (`expense-icon-options.ts`) consumed by all icon-related components. Build a shared `IconPicker` grid component. Add a `CreateCategoryModal` triggered from the expense form's category dropdown. Update the category manager and `CategoryIcon` to use the shared registry.

**Tech Stack:** React 19, TypeScript, lucide-react, @tanstack/react-query, @base-ui-components/react (Dialog, Select), Vitest + @testing-library/react

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `web/src/components/financial/expenses/expense-icon-options.ts` | Create | Unified icon registry — single source of truth for all 28 icons |
| `web/src/components/financial/expenses/icon-picker.tsx` | Create | Shared icon grid picker component |
| `web/src/components/financial/expenses/create-category-modal.tsx` | Create | Modal for inline category creation from expense form |
| `web/src/components/financial/expenses/category-icon.tsx` | Modify | Use unified registry instead of internal ICON_MAP |
| `web/src/components/financial/expenses/expense-form.tsx` | Modify | Add "+ Nova categoria" button next to Select + modal integration |
| `web/src/components/financial/settings/expense-categories-manager.tsx` | Modify | Use shared IconPicker instead of inline icon select |
| `web/src/components/financial/expenses/expense-list.tsx` | Verify | Imports `getCategoryIcon` — no changes needed, verify it works after Task 4 |
| `web/src/components/financial/expenses/__tests__/expense-icon-options.test.ts` | Create | Tests for icon registry |
| `web/src/components/financial/expenses/__tests__/icon-picker.test.tsx` | Create | Tests for icon picker component |
| `web/src/components/financial/expenses/__tests__/create-category-modal.test.tsx` | Create | Tests for create category modal |

---

## Group A — Icon Registry (foundation, no dependencies)

### Task 1: Unified Icon Registry

**Files:**
- Create: `web/src/components/financial/expenses/expense-icon-options.ts`
- Test: `web/src/components/financial/expenses/__tests__/expense-icon-options.test.ts`

- [ ] **Step 1: Write the test file**

```ts
// web/src/components/financial/expenses/__tests__/expense-icon-options.test.ts
import { describe, it, expect } from 'vitest'
import {
  EXPENSE_ICON_OPTIONS,
  getExpenseIcon,
} from '../expense-icon-options'
import { CircleIcon } from 'lucide-react'

describe('EXPENSE_ICON_OPTIONS', () => {
  it('contains 28 icons', () => {
    expect(EXPENSE_ICON_OPTIONS).toHaveLength(28)
  })

  it('has no duplicate values', () => {
    const values = EXPENSE_ICON_OPTIONS.map((o) => o.value)
    expect(new Set(values).size).toBe(values.length)
  })

  it('every option has value, label, and icon', () => {
    for (const opt of EXPENSE_ICON_OPTIONS) {
      expect(opt.value).toBeTruthy()
      expect(opt.label).toBeTruthy()
      expect(typeof opt.icon).toBe('function')
    }
  })

  it('includes expected icons', () => {
    const values = EXPENSE_ICON_OPTIONS.map((o) => o.value)
    expect(values).toContain('syringe')
    expect(values).toContain('home')
    expect(values).toContain('circle')
    expect(values).toContain('scissors')
    expect(values).toContain('heart')
  })
})

describe('getExpenseIcon', () => {
  it('returns CircleIcon for unknown icon name', () => {
    expect(getExpenseIcon('nonexistent')).toBe(CircleIcon)
  })

  it('returns CircleIcon for null/undefined', () => {
    expect(getExpenseIcon(null as unknown as string)).toBe(CircleIcon)
    expect(getExpenseIcon(undefined as unknown as string)).toBe(CircleIcon)
  })

  it('returns correct icon for known name', () => {
    const icon = getExpenseIcon('home')
    expect(typeof icon).toBe('function')
    expect(icon).not.toBe(CircleIcon)
  })

  it('handles case-insensitively', () => {
    const icon = getExpenseIcon('HOME')
    expect(typeof icon).toBe('function')
    expect(icon).not.toBe(CircleIcon)
  })

  it('resolves legacy icon aliases', () => {
    for (const name of ['zap', 'droplet', 'shopping_cart', 'shopping-cart', 'book_open', 'book-open', 'car', 'globe']) {
      const icon = getExpenseIcon(name)
      expect(icon).not.toBe(CircleIcon)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/giorgiofellipe/Work/floraclin && pnpm --filter web test:run -- --reporter=verbose web/src/components/financial/expenses/__tests__/expense-icon-options.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the icon registry**

```ts
// web/src/components/financial/expenses/expense-icon-options.ts
import {
  SyringeIcon,
  PillIcon,
  HeartIcon,
  ScissorsIcon,
  SparklesIcon,
  DropletsIcon,
  ShieldIcon,
  HomeIcon,
  BuildingIcon,
  WrenchIcon,
  LightbulbIcon,
  WifiIcon,
  SprayCanIcon,
  PrinterIcon,
  UsersIcon,
  BriefcaseIcon,
  GraduationCapIcon,
  ScaleIcon,
  CreditCardIcon,
  ReceiptIcon,
  WalletIcon,
  PackageIcon,
  TruckIcon,
  MegaphoneIcon,
  PhoneIcon,
  MonitorIcon,
  CoffeeIcon,
  CircleIcon,
  type LucideIcon,
} from 'lucide-react'

export interface ExpenseIconOption {
  value: string
  label: string
  icon: LucideIcon
}

export const EXPENSE_ICON_OPTIONS: ExpenseIconOption[] = [
  // Clinic / Medical
  { value: 'syringe', label: 'Injetáveis', icon: SyringeIcon },
  { value: 'pill', label: 'Farmácia', icon: PillIcon },
  { value: 'heart', label: 'Bem-estar', icon: HeartIcon },
  { value: 'scissors', label: 'Estética', icon: ScissorsIcon },
  { value: 'sparkles', label: 'Cosmético', icon: SparklesIcon },
  { value: 'droplets', label: 'Skincare', icon: DropletsIcon },
  { value: 'shield', label: 'Seguro', icon: ShieldIcon },
  // Operations
  { value: 'home', label: 'Aluguel', icon: HomeIcon },
  { value: 'building', label: 'Estrutura', icon: BuildingIcon },
  { value: 'wrench', label: 'Manutenção', icon: WrenchIcon },
  { value: 'lightbulb', label: 'Utilidades', icon: LightbulbIcon },
  { value: 'wifi', label: 'Internet', icon: WifiIcon },
  { value: 'spray-can', label: 'Limpeza', icon: SprayCanIcon },
  { value: 'printer', label: 'Escritório', icon: PrinterIcon },
  // People / Services
  { value: 'users', label: 'Pessoal', icon: UsersIcon },
  { value: 'briefcase', label: 'Serviços', icon: BriefcaseIcon },
  { value: 'graduation-cap', label: 'Cursos', icon: GraduationCapIcon },
  { value: 'scale', label: 'Jurídico', icon: ScaleIcon },
  // Finance / Logistics
  { value: 'credit-card', label: 'Pagamentos', icon: CreditCardIcon },
  { value: 'receipt', label: 'Impostos', icon: ReceiptIcon },
  { value: 'wallet', label: 'Finanças', icon: WalletIcon },
  { value: 'package', label: 'Insumos', icon: PackageIcon },
  { value: 'truck', label: 'Frete', icon: TruckIcon },
  // Marketing / Communication
  { value: 'megaphone', label: 'Marketing', icon: MegaphoneIcon },
  { value: 'phone', label: 'Telecom', icon: PhoneIcon },
  { value: 'monitor', label: 'Equipamento', icon: MonitorIcon },
  // General
  { value: 'coffee', label: 'Copa', icon: CoffeeIcon },
  { value: 'circle', label: 'Outros', icon: CircleIcon },
]

const ICON_MAP = new Map(
  EXPENSE_ICON_OPTIONS.map((o) => [o.value, o.icon]),
)

// Legacy aliases — icons that existed in the old category-icon.tsx but are not
// in the picker grid. Kept so existing DB records render correctly.
import {
  ZapIcon,
  DropletIcon,
  ShoppingCartIcon,
  BookOpenIcon,
  CarIcon,
  GlobeIcon,
} from 'lucide-react'

const LEGACY_ALIASES: [string, LucideIcon][] = [
  ['zap', ZapIcon],
  ['droplet', DropletIcon],
  ['shopping_cart', ShoppingCartIcon],
  ['shopping-cart', ShoppingCartIcon],
  ['book_open', BookOpenIcon],
  ['book-open', BookOpenIcon],
  ['credit_card', CreditCardIcon],
  ['car', CarIcon],
  ['globe', GlobeIcon],
]

for (const [key, icon] of LEGACY_ALIASES) {
  if (!ICON_MAP.has(key)) ICON_MAP.set(key, icon)
}

export function getExpenseIcon(iconName: string | null | undefined): LucideIcon {
  if (!iconName) return CircleIcon
  return ICON_MAP.get(iconName.toLowerCase()) ?? CircleIcon
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/giorgiofellipe/Work/floraclin && pnpm --filter web test:run -- --reporter=verbose web/src/components/financial/expenses/__tests__/expense-icon-options.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/financial/expenses/expense-icon-options.ts web/src/components/financial/expenses/__tests__/expense-icon-options.test.ts
git commit -m "feat: unified expense icon registry with 28 clinic-relevant icons"
```

---

## Group B (depends on A) — Icon Picker

### Task 2: Icon Picker Component

**Files:**
- Create: `web/src/components/financial/expenses/icon-picker.tsx`
- Test: `web/src/components/financial/expenses/__tests__/icon-picker.test.tsx`

- [ ] **Step 1: Write the test file**

```tsx
// web/src/components/financial/expenses/__tests__/icon-picker.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IconPicker } from '../icon-picker'

describe('IconPicker', () => {
  it('renders 28 icon buttons', () => {
    render(<IconPicker value="circle" onChange={vi.fn()} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(28)
  })

  it('marks the selected icon', () => {
    render(<IconPicker value="home" onChange={vi.fn()} />)
    const selected = screen.getByRole('button', { name: 'Aluguel' })
    expect(selected).toHaveAttribute('data-selected', 'true')
  })

  it('calls onChange when an icon is clicked', async () => {
    const onChange = vi.fn()
    render(<IconPicker value="circle" onChange={onChange} />)

    const syringeButton = screen.getByRole('button', { name: 'Injetáveis' })
    await userEvent.click(syringeButton)

    expect(onChange).toHaveBeenCalledWith('syringe')
  })

  it('shows tooltip labels via title attribute', () => {
    render(<IconPicker value="circle" onChange={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Aluguel' })
    expect(button).toHaveAttribute('title', 'Aluguel')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/giorgiofellipe/Work/floraclin && pnpm --filter web test:run -- --reporter=verbose web/src/components/financial/expenses/__tests__/icon-picker.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Create the icon picker component**

```tsx
// web/src/components/financial/expenses/icon-picker.tsx
'use client'

import { EXPENSE_ICON_OPTIONS } from './expense-icon-options'
import { cn } from '@/lib/utils'

interface IconPickerProps {
  value: string
  onChange: (value: string) => void
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {EXPENSE_ICON_OPTIONS.map((opt) => {
        const Icon = opt.icon
        const isSelected = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="button"
            title={opt.label}
            aria-label={opt.label}
            data-selected={isSelected}
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex items-center justify-center w-10 h-10 rounded-md border transition-colors',
              isSelected
                ? 'border-forest bg-[#F0F7F1] ring-2 ring-forest'
                : 'border-[#E8ECEF] bg-white hover:bg-[#F4F6F8]',
            )}
          >
            <Icon
              className={cn(
                'h-5 w-5',
                isSelected ? 'text-forest' : 'text-charcoal',
              )}
            />
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/giorgiofellipe/Work/floraclin && pnpm --filter web test:run -- --reporter=verbose web/src/components/financial/expenses/__tests__/icon-picker.test.tsx`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/financial/expenses/icon-picker.tsx web/src/components/financial/expenses/__tests__/icon-picker.test.tsx
git commit -m "feat: shared icon picker grid component for expense categories"
```

---

## Group C (depends on B) — Create Category Modal + Update CategoryIcon (parallel)

### Task 3: Create Category Modal

**Files:**
- Create: `web/src/components/financial/expenses/create-category-modal.tsx`
- Test: `web/src/components/financial/expenses/__tests__/create-category-modal.test.tsx`

- [ ] **Step 1: Write the test file**

```tsx
// web/src/components/financial/expenses/__tests__/create-category-modal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreateCategoryModal } from '../create-category-modal'

const mockMutateAsync = vi.fn()

vi.mock('@/hooks/mutations/use-financial-settings-mutations', () => ({
  useCreateExpenseCategory: vi.fn().mockReturnValue({
    mutateAsync: (...args: unknown[]) => mockMutateAsync(...args),
    isPending: false,
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('CreateCategoryModal', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onCreated: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockMutateAsync.mockResolvedValue({ data: { id: 'new-cat-id', name: 'Test', icon: 'circle' } })
  })

  it('renders modal with name input and icon picker', () => {
    render(<CreateCategoryModal {...defaultProps} />, { wrapper: createWrapper() })

    expect(screen.getByText('Nova Categoria')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Nome da categoria')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Outros' })).toHaveLength(1)
  })

  it('disables Criar button when name is empty', () => {
    render(<CreateCategoryModal {...defaultProps} />, { wrapper: createWrapper() })

    const createButton = screen.getByRole('button', { name: 'Criar' })
    expect(createButton).toBeDisabled()
  })

  it('calls mutateAsync and onCreated on successful submit', async () => {
    render(<CreateCategoryModal {...defaultProps} />, { wrapper: createWrapper() })

    const nameInput = screen.getByPlaceholderText('Nome da categoria')
    await userEvent.type(nameInput, 'Nova Cat')

    const createButton = screen.getByRole('button', { name: 'Criar' })
    await userEvent.click(createButton)

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({ name: 'Nova Cat', icon: 'circle' })
    })
    expect(defaultProps.onCreated).toHaveBeenCalledWith('new-cat-id')
  })

  it('submits via Enter key on name input', async () => {
    render(<CreateCategoryModal {...defaultProps} />, { wrapper: createWrapper() })

    const nameInput = screen.getByPlaceholderText('Nome da categoria')
    await userEvent.type(nameInput, 'Via Enter{Enter}')

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({ name: 'Via Enter', icon: 'circle' })
    })
  })

  it('closes modal on successful creation', async () => {
    render(<CreateCategoryModal {...defaultProps} />, { wrapper: createWrapper() })

    const nameInput = screen.getByPlaceholderText('Nome da categoria')
    await userEvent.type(nameInput, 'Nova')
    await userEvent.click(screen.getByRole('button', { name: 'Criar' }))

    await waitFor(() => {
      expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('shows error message when mutation fails', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Categoria duplicada'))

    render(<CreateCategoryModal {...defaultProps} />, { wrapper: createWrapper() })

    const nameInput = screen.getByPlaceholderText('Nome da categoria')
    await userEvent.type(nameInput, 'Duplicada')

    const createButton = screen.getByRole('button', { name: 'Criar' })
    await userEvent.click(createButton)

    await waitFor(() => {
      expect(screen.getByText('Categoria duplicada')).toBeInTheDocument()
    })
    expect(defaultProps.onCreated).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/giorgiofellipe/Work/floraclin && pnpm --filter web test:run -- --reporter=verbose web/src/components/financial/expenses/__tests__/create-category-modal.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Create the modal component**

```tsx
// web/src/components/financial/expenses/create-category-modal.tsx
'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { IconPicker } from './icon-picker'
import { useCreateExpenseCategory } from '@/hooks/mutations/use-financial-settings-mutations'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

interface CreateCategoryModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (categoryId: string) => void
}

export function CreateCategoryModal({
  open,
  onOpenChange,
  onCreated,
}: CreateCategoryModalProps) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('circle')
  const [error, setError] = useState<string | null>(null)
  const createCategory = useCreateExpenseCategory()

  function handleClose() {
    setName('')
    setIcon('circle')
    setError(null)
    onOpenChange(false)
  }

  async function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) return
    setError(null)

    try {
      const result = await createCategory.mutateAsync({ name: trimmed, icon })
      toast.success('Categoria criada com sucesso')
      const newId = result?.data?.id
      handleClose()
      if (newId) onCreated(newId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar categoria')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Nova Categoria</DialogTitle>
          <DialogDescription>
            Crie uma categoria para organizar suas despesas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="uppercase tracking-wider text-xs font-medium text-mid">
              Nome
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome da categoria"
              maxLength={100}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) {
                  e.preventDefault()
                  handleCreate()
                }
              }}
            />
          </div>

          <div className="space-y-2">
            <Label className="uppercase tracking-wider text-xs font-medium text-mid">
              Ícone
            </Label>
            <IconPicker value={icon} onChange={setIcon} />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={createCategory.isPending || !name.trim()}
          >
            {createCategory.isPending ? (
              <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : (
              'Criar'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/giorgiofellipe/Work/floraclin && pnpm --filter web test:run -- --reporter=verbose web/src/components/financial/expenses/__tests__/create-category-modal.test.tsx`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/financial/expenses/create-category-modal.tsx web/src/components/financial/expenses/__tests__/create-category-modal.test.tsx
git commit -m "feat: create category modal for inline expense category creation"
```

---

### Task 4: Update CategoryIcon to Use Unified Registry

**Files:**
- Modify: `web/src/components/financial/expenses/category-icon.tsx`

- [ ] **Step 1: Replace category-icon.tsx with unified registry**

Replace the entire contents of `web/src/components/financial/expenses/category-icon.tsx` with:

```tsx
// web/src/components/financial/expenses/category-icon.tsx
import { getExpenseIcon } from './expense-icon-options'

export { getExpenseIcon as getCategoryIcon }
```

The public API stays the same — `getCategoryIcon(iconName)` still returns a `LucideIcon`. All icon imports now come through the unified registry.

- [ ] **Step 2: Run existing tests to verify nothing broke**

Run: `cd /Users/giorgiofellipe/Work/floraclin && pnpm --filter web test:run -- --reporter=verbose`
Expected: All tests PASS (existing expense-form tests import `getCategoryIcon` which still works)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/financial/expenses/category-icon.tsx
git commit -m "refactor: category-icon uses unified expense icon registry"
```

---

## Group D (depends on C) — Integration: Expense Form + Category Manager (parallel)

### Task 5: Add "+ Nova categoria" to Expense Form

**Files:**
- Modify: `web/src/components/financial/expenses/expense-form.tsx`

- [ ] **Step 1: Add imports and state for the create category modal**

At the top of `expense-form.tsx`, add these imports:

```tsx
import { PlusIcon } from 'lucide-react'
import { CreateCategoryModal } from './create-category-modal'
```

Inside `ExpenseForm` component, add state:

```tsx
const [createCategoryOpen, setCreateCategoryOpen] = useState(false)
```

- [ ] **Step 2: Add the "+ Nova categoria" button next to the SelectTrigger**

Base UI's `SelectContent` wraps children in `SelectPrimitive.List` which only accepts `SelectItem` elements. Arbitrary DOM nodes break keyboard navigation and ARIA. Instead, place the button **adjacent** to the `SelectTrigger`.

Find the category `<Controller>` render. Wrap the `<Select>` in a flex container and add the button after the trigger:

```tsx
<Controller
  name="categoryId"
  control={control}
  rules={{ required: 'Categoria é obrigatória' }}
  render={({ field }) => (
    <div className="flex items-center gap-2">
      <Select items={categoryItems} value={field.value} onValueChange={(v) => field.onChange(v ?? '')} className="flex-1">
        <SelectTrigger className="w-full" data-testid="expense-category-select">
          <SelectValue placeholder="Selecione a categoria" />
        </SelectTrigger>
        <SelectContent>
          {categoryList.map((cat) => {
            const Icon = getCategoryIcon(cat.icon)
            return (
              <SelectItem key={cat.id} value={cat.id}>
                <span className="flex items-center gap-2">
                  <Icon className="size-4 text-sage" />
                  {cat.name}
                </span>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={() => setCreateCategoryOpen(true)}
        title="Nova categoria"
      >
        <PlusIcon className="h-4 w-4" />
      </Button>
    </div>
  )}
/>
```

- [ ] **Step 3: Add the CreateCategoryModal at the bottom of the form's JSX**

Right before the closing `</Dialog>` of the expense form, add:

```tsx
<CreateCategoryModal
  open={createCategoryOpen}
  onOpenChange={setCreateCategoryOpen}
  onCreated={(categoryId) => {
    setValue('categoryId', categoryId)
  }}
/>
```

- [ ] **Step 4: Run existing expense form tests**

Run: `cd /Users/giorgiofellipe/Work/floraclin && pnpm --filter web test:run -- --reporter=verbose web/src/components/financial/expenses/__tests__/expense-form.test.tsx`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/financial/expenses/expense-form.tsx
git commit -m "feat: add inline category creation to expense form"
```

---

### Task 6: Update Category Manager to Use Shared IconPicker

**Files:**
- Modify: `web/src/components/financial/settings/expense-categories-manager.tsx`

- [ ] **Step 1: Replace icon imports and constants**

Remove from the imports section all individual icon imports used for the picker:
`HomeIcon, PackageIcon, UsersIcon, MegaphoneIcon, MonitorIcon, ReceiptIcon, BriefcaseIcon, WrenchIcon, WalletIcon, CarIcon, CoffeeIcon, GlobeIcon, HeartIcon`

Remove these constants entirely:
- `ICON_ITEMS` (the Record)
- `ICON_OPTIONS` (the array)
- `ICON_MAP` (the Record)
- The local `getCategoryIcon` function

Add these imports instead:

```tsx
import { IconPicker } from '@/components/financial/expenses/icon-picker'
import { getExpenseIcon } from '@/components/financial/expenses/expense-icon-options'
```

Keep `CircleIcon` import only if needed elsewhere — actually it's no longer needed since `getExpenseIcon` handles the fallback. Remove it too.

- [ ] **Step 2: Replace the icon Select in the edit row**

Find the editing row (the `if (isEditing)` block). Replace the `<Select>` component for icon selection with:

```tsx
<IconPicker value={editIcon} onChange={setEditIcon} />
```

This replaces the dropdown with the grid. Since the edit row is a flex container, wrap the IconPicker in a container to avoid it stretching:

Replace the entire editing `<div>` block contents (the one inside `if (isEditing)`) with:

```tsx
<div
  key={category.id}
  className="p-3 rounded-lg bg-[#F4F6F8] border border-[#E8ECEF] space-y-3"
>
  <div className="flex items-center gap-3">
    <Input
      value={editName}
      onChange={(e) => setEditName(e.target.value)}
      className="flex-1"
      autoFocus
    />
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      onClick={handleUpdate}
      disabled={updateCategory.isPending}
    >
      <CheckIcon className="h-4 w-4 text-[#4A6B52]" />
    </Button>
    <Button type="button" size="icon-sm" variant="ghost" onClick={cancelEdit}>
      <XIcon className="h-4 w-4 text-mid" />
    </Button>
  </div>
  <IconPicker value={editIcon} onChange={setEditIcon} />
</div>
```

- [ ] **Step 3: Replace the icon Select in the add form**

Find the `showAddForm` block. Replace the entire add form with:

```tsx
<div className="p-3 rounded-lg bg-[#F4F6F8] border border-[#E8ECEF] space-y-3">
  <div className="flex items-center gap-3">
    <Input
      value={newName}
      onChange={(e) => setNewName(e.target.value)}
      placeholder="Nome da categoria"
      className="flex-1"
      autoFocus
    />
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      onClick={handleAdd}
      disabled={createCategory.isPending || !newName.trim()}
    >
      <CheckIcon className="h-4 w-4 text-[#4A6B52]" />
    </Button>
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      onClick={() => {
        setShowAddForm(false)
        setNewName('')
        setNewIcon('circle')
      }}
    >
      <XIcon className="h-4 w-4 text-mid" />
    </Button>
  </div>
  <IconPicker value={newIcon} onChange={setNewIcon} />
</div>
```

- [ ] **Step 4: Update the category list icon rendering**

In the non-editing category row, replace:

```tsx
const Icon = getCategoryIcon(category.icon)
```

with:

```tsx
const Icon = getExpenseIcon(category.icon)
```

- [ ] **Step 5: Remove the Select import if no longer used**

Remove the `Select, SelectTrigger, SelectValue, SelectContent, SelectItem` imports if they're no longer used anywhere in the file. Check carefully first — delete only if no other usage exists.

- [ ] **Step 6: Run all tests**

Run: `cd /Users/giorgiofellipe/Work/floraclin && pnpm --filter web test:run -- --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add web/src/components/financial/settings/expense-categories-manager.tsx
git commit -m "refactor: expense category manager uses shared icon picker and registry"
```

---

## Parallelization Summary

```
Group A: Task 1 (expense-icon-options.ts)
Group B: Task 2 (icon-picker.tsx) — depends on A
Group C: Task 3 (create-category-modal.tsx) + Task 4 (category-icon.tsx) — parallel, depend on B/A
Group D: Task 5 (expense-form.tsx) + Task 6 (expense-categories-manager.tsx) — parallel, depend on C
```
