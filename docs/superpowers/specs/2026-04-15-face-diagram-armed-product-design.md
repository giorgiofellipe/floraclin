# Face Diagram — Armed Product Quick-Entry

## Goal

Eliminate the friction of re-selecting a product for every placed point on the face diagram. Let the user pick a product once from an autocomplete above the canvas; subsequent clicks open a minimal quick-entry modal with the product pre-filled and the quantity field focused, so placing N points of the same product collapses to `click → type → Enter` per point.

## Problem

Today, `face-diagram-editor.tsx` opens `PointFormModal` on every click on the face canvas. The modal forces the user to:

1. Open a grouped product dropdown
2. Search and select a product
3. Tab to the quantity input
4. Type a number
5. Click "Adicionar"

For planning a procedure that drops 4–8 points of the same product (typical botox forehead planning), this is 4–8× of step 1–2 repeated for identical inputs. Practitioners have complained about it explicitly.

## Non-goals

- No "paint mode" that eliminates the modal entirely — the user explicitly wants the quantity field to be a conscious entry per point (medical-safety reasoning).
- No per-product quantity memory — every point gets a fresh empty quantity field.
- No bulk edit, no undo/redo, no keyboard product-switch shortcuts, no drag-to-reposition.
- No change to the `DiagramPointData` wire shape or the planning/execution zod schemas.

## Design

### Armed-product strip

A new strip renders above the face canvas, below the existing `Frontal / Esquerdo / Direito` view tabs, visible only when `readOnly` is false:

```
┌────────────────────────────────────────────────┐
│  Produto:  [ Buscar produto...        ▾ ]   × │
└────────────────────────────────────────────────┘
```

- **Autocomplete** — searchable dropdown over the `products` catalog prop already passed into `FaceDiagramEditor`. Grouped by category using the same `CATEGORY_LABELS` map that `PointFormModal` uses today. Search matches `name` (case-insensitive substring).
- **Clear button** (`×`) — visible only when a product is armed. Clicking it unarms (resets `armedProductId` to `null`).
- **No quantity input in the strip.** The strip is purely for arming the product.
- **Placeholder message** (below the strip, when no product is armed): "Selecione um produto para começar a marcar pontos."

### State

`FaceDiagramEditor` gains one piece of local state:

```ts
const [armedProductId, setArmedProductId] = useState<string | null>(null)
```

Derived: `armedProduct = products?.find((p) => p.id === armedProductId) ?? null`.

### Click behavior on the face canvas

Replaces the current `handleFaceClick`:

```
if (readOnly) return
if (!products || products.length === 0) return

compute (x, y) as before

if (armedProduct) {
  setEditingPoint({
    x, y, viewType: activeView,
    productName: armedProduct.name,
    activeIngredient: armedProduct.activeIngredient ?? undefined,
    quantityUnit: armedProduct.defaultUnit,
    // quantity intentionally omitted — modal will focus that field
  })
} else {
  setEditingPoint({ x, y, viewType: activeView })
}
setModalOpen(true)
```

- **No product armed** → modal opens empty (current behavior preserved as fallback).
- **Product armed** → modal opens with product, active ingredient, and unit pre-filled; quantity field empty and focused.

### `PointFormModal` changes

Minimal edits:

1. **Auto-focus the quantity input** on mount when `point.productName` is pre-filled AND `!point.id` (new point, product pre-armed). Existing edits (where `point.id` exists) keep the current no-autofocus behavior so the user doesn't lose their current cursor position.

2. **Enter-to-submit** — this already works because the modal wraps everything in a `<form onSubmit={handleSubmit}>`. Verify during implementation and add explicit test if needed.

3. **Product dropdown remains editable.** If the user decides this specific point needs a different product (one-off override), they can change it in the modal without unarming. This is a safety escape hatch, not the primary path.

4. **No other behavior change.** `Detalhes adicionais` collapse, unit toggle, delete button, cancel button all unchanged.

### Editing existing points

Unchanged: clicking a placed point on the canvas still opens `PointFormModal` with all its data pre-filled. No auto-focus since editing typically starts from the product or another specific field.

## Interaction walkthroughs

**Scenario 1: 4 points of botox, same dose**

1. User arrives on step 3, opens the face diagram section
2. Autocomplete → types "bot" → picks "Botox Allergan 100U" → armed
3. Click point 1 on forehead → modal opens, product = Botox Allergan 100U, unit = U, quantity field empty + focused
4. Types `2` → presses Enter → modal closes, point placed
5. Click point 2 → same modal → types `2` → Enter → placed
6. Repeat for points 3, 4
7. Total interactions: 1 autocomplete pick + 4 × (click → type "2" → Enter) ≈ 15 clicks/keystrokes vs ~40 today

**Scenario 2: 2 products in sequence**

1. User arms Botox → drops 4 points as above
2. Re-opens autocomplete → selects "Juvederm Voluma" → new product armed (no reset of placed points)
3. Clicks forehead → modal opens with Juvederm pre-filled, unit = mL, quantity empty + focused
4. Types `0.5` → Enter → placed

**Scenario 3: override product for one point**

1. User has Botox armed, drops 3 points
2. Realizes point 4 needs a filler instead
3. Clicks point 4 on face → modal opens with Botox pre-filled
4. User changes the product dropdown to a filler → unit auto-updates → types quantity → Enter
5. Point 4 has the filler; Botox is still armed for the next click

**Scenario 4: disarming**

1. User arms Botox, drops some points
2. Clicks `×` on the strip to unarm
3. Next click on the canvas opens the modal empty (current behavior for cold entry)

## Files affected

**Modified:**
- `web/src/components/face-diagram/face-diagram-editor.tsx` — add `armedProductId` state, render `<ArmedProductStrip>`, rewrite `handleFaceClick` to pre-fill `editingPoint` with armed product data, update the empty-state helper message to reflect armed-vs-unarmed state.
- `web/src/components/face-diagram/point-form-modal.tsx` — add `autoFocus` on the quantity `<Input>` when `point.productName` is pre-filled AND `!point.id`. No other changes.

**Created:**
- `web/src/components/face-diagram/armed-product-strip.tsx` — new subcomponent. Props: `products: CatalogProduct[]`, `armedProductId: string | null`, `onArmedProductIdChange: (id: string | null) => void`. Renders the autocomplete + clear button + placeholder message.

**Unchanged:**
- `web/src/components/face-diagram/types.ts` — `DiagramPointData` shape is unchanged.
- `web/src/validations/procedure.ts` — `diagramPointSchema` is unchanged.
- All test files.

## Autocomplete component

The project's existing `@base-ui-components/react` `Select` is a categorical dropdown without type-to-filter search, which isn't enough here (clinics may have 20+ products and the user wants to type to narrow). The plan builds a small local combobox inside `armed-product-strip.tsx`:

- Trigger button rendered as an input that shows the armed product name or a placeholder
- `<Popover>` opens below on click/focus, containing:
  - A text `<Input>` for filtering (autofocused when popover opens)
  - A filtered list of `CatalogProduct` items grouped by category
  - Keyboard nav: arrow up/down to highlight, Enter to select, Escape to close
- Arrow-key nav is optional for v1 — initial implementation can rely on click-to-select, then add keyboard nav if it feels missing during smoke test

If during implementation a reusable combobox primitive turns up in `web/src/components/ui/`, the agent will use it instead. Otherwise the local build above ships.

## Testing

- **Unit test for `<ArmedProductStrip>`** — renders, searches, selects, fires `onArmedProductIdChange` on pick, clears on × click.
- **Behavior test for `FaceDiagramEditor`** — with a mocked `products` array and a `armedProductId` provided via interaction, simulate a click on the canvas and assert that `onChange` is called with a point whose `productName`, `activeIngredient`, and `quantityUnit` match the armed product AND that the modal opens with the quantity field focused.
- **Edit-existing-point regression** — click an existing point, assert modal opens with all data pre-filled and quantity NOT auto-focused.

No changes to e2e or integration tests. No schema changes means no backend test impact.

## Risk assessment

**Low risk:**
- Changes are confined to the face-diagram editor UI and a single new subcomponent.
- No API, schema, or wire format changes.
- Existing modal path is preserved as the cold-entry fallback.
- No migration needed.

**Medium risk:**
- If the autocomplete component needs to be built from scratch, there's some UX tuning to get right (keyboard nav, focus trapping, accessibility). Mitigated by starting with a simple `<Popover>` + filtered list.
- `autoFocus` interaction with base UI's focus management in `Dialog` — may need a small `useEffect` with a ref rather than the DOM `autoFocus` prop. Standard pattern.

## Commit policy

Per standing user preference: no commits until explicit approval.
