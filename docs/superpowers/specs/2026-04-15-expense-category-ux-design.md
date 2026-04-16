# Expense Category UX Improvements

## Goal

Improve the expense category workflow: allow inline category creation from the expense form, rework the icon picker to a compact grid with clinic-relevant icons, and unify the icon definitions into a single source of truth.

## Architecture

Three changes, all in the `web/src/components/financial/` subtree plus a shared constant file. No database schema changes — the existing `expense_categories` table already supports custom categories with arbitrary icon strings.

## Change 1: Unified Icon Registry

**File:** `web/src/components/financial/expenses/expense-icon-options.ts` (new)

Single source of truth for all expense category icons. Replaces the separate icon lists in `category-icon.tsx` and `expense-categories-manager.tsx`.

```ts
export interface ExpenseIconOption {
  value: string        // stored in DB (e.g. 'syringe')
  label: string        // Portuguese tooltip (e.g. 'Injetáveis')
  icon: LucideIcon     // lucide-react component
}
```

**28 icons**, grouped logically in the array for readability but rendered as a flat grid:

| Group | Icons |
|-------|-------|
| Clinic/Medical | syringe (Injetáveis), pill (Farmácia), heart (Bem-estar), scissors (Estética), sparkles (Cosmético), droplets (Skincare), shield (Seguro) |
| Operations | home (Aluguel), building (Estrutura), wrench (Manutenção), lightbulb (Utilidades), wifi (Internet), spray-can (Limpeza), printer (Escritório) |
| People/Services | users (Pessoal), briefcase (Serviços), graduation-cap (Cursos), scale (Jurídico) |
| Finance/Logistics | credit-card (Pagamentos), receipt (Impostos), wallet (Finanças), package (Insumos), truck (Frete) |
| Marketing/Comms | megaphone (Marketing), phone (Telecom), monitor (Equipamento) |
| General | coffee (Copa), circle (Outros) |

Export: `EXPENSE_ICON_OPTIONS: ExpenseIconOption[]` and a helper `getExpenseIcon(value: string): LucideIcon` that returns the icon component (falling back to `CircleIcon`).

**Consumers:**
- `CategoryIcon` component — replace its internal `ICON_MAP` with `getExpenseIcon()`
- `ExpenseCategoriesManager` — replace its `ICON_OPTIONS` with `EXPENSE_ICON_OPTIONS`
- New `IconPicker` component (see below)
- New `CreateCategoryModal` component (see below)

## Change 2: Icon Picker Component

**File:** `web/src/components/financial/expenses/icon-picker.tsx` (new)

Shared icon picker used in both the category manager and the new inline creation modal.

**Props:**
- `value: string` — currently selected icon value
- `onChange: (value: string) => void`

**UI:**
- Flat grid, 7 columns, ~40px per cell
- Each cell renders the lucide icon at 20px
- Subtle border (`border-[#E8ECEF]`), rounded corners
- Hover: slightly darker background
- Selected: green ring (`ring-2 ring-forest`) with light green background
- Tooltip on hover showing the Portuguese label (use `title` attribute for simplicity)
- No group dividers — flat presentation

## Change 3: Inline Category Creation from Expense Form

**File:** `web/src/components/financial/expenses/create-category-modal.tsx` (new)

Small modal triggered from within the expense form's category Select dropdown.

**Trigger:** A sticky footer item in the category Select: `"+ Nova categoria"` with a PlusIcon. This is appended after all existing category options.

**Modal contents:**
- Title: "Nova Categoria"
- Name input (required, max 100 chars, auto-focused)
- Icon picker grid (the shared `IconPicker` component, default selection: `circle`)
- Footer: "Cancelar" (ghost) + "Criar" (primary) buttons
- Loading state on "Criar" while POST is in flight

**Flow:**
1. User opens expense form → selects category dropdown → clicks "+ Nova categoria"
2. Modal opens over the expense form (the Select closes)
3. User types name, picks icon, clicks "Criar"
4. POST to `/api/financial/settings/categories` with `{ name, icon }`
5. On success: invalidate `queryKeys.financial.categories`, auto-select the new category ID in the expense form's `categoryId` field, close modal, show success toast
6. On error: show error inline in the modal, keep it open

**Validation:** Same as existing `expenseCategorySchema` — name 1-100 chars, icon 1-50 chars.

## Change 4: Update Existing Category Manager

**File:** `web/src/components/financial/settings/expense-categories-manager.tsx` (modify)

- Replace the inline `ICON_OPTIONS` array with import from `expense-icon-options.ts`
- Replace the current icon picker UI (button grid with labels) with the shared `IconPicker` component
- No other behavioral changes

## Change 5: Update CategoryIcon Component

**File:** `web/src/components/financial/expenses/category-icon.tsx` (modify)

- Replace the internal `ICON_MAP` with `getExpenseIcon()` from the unified registry
- Remove all individual lucide-react icon imports (they come through the registry now)
- Keep the component's public API unchanged: `<CategoryIcon icon="syringe" className="..." />`

## Files Changed

| File | Action |
|------|--------|
| `web/src/components/financial/expenses/expense-icon-options.ts` | Create — unified icon registry |
| `web/src/components/financial/expenses/icon-picker.tsx` | Create — shared grid picker |
| `web/src/components/financial/expenses/create-category-modal.tsx` | Create — inline creation modal |
| `web/src/components/financial/expenses/category-icon.tsx` | Modify — use unified registry |
| `web/src/components/financial/expenses/expense-form.tsx` | Modify — add "+ Nova categoria" trigger + modal |
| `web/src/components/financial/settings/expense-categories-manager.tsx` | Modify — use shared IconPicker |

## Edge Cases

- **Duplicate name:** The API already returns an error for duplicate category names within a tenant. The modal shows this error inline.
- **Icon not in registry:** `getExpenseIcon()` falls back to `CircleIcon`. Old categories with icons not in the new set still render fine.
- **Modal dismissed:** No side effects — expense form stays as-is.
- **Network error during create:** Error shown in modal, user can retry.
- **Rapid double-click on "Criar":** Disable button while mutation is pending (standard pattern with `isPending` from the mutation hook).

## Not In Scope

- Reordering icons within the picker (fixed order from the registry array)
- Category search/filter within the picker (28 icons fits in a single screen)
- Editing categories from the expense form (only creation — editing stays in settings)
- Changes to the expense_categories DB schema
- Changes to seed data (existing 9 system categories keep their current icons)
