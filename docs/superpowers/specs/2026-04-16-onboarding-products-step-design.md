# Onboarding Products Step

## Goal

Replace the current US/Europe-centric default products catalog with a Brazilian-market-curated catalog, and add a new onboarding step that lets the clinic owner select which defaults to include and add custom products — instead of auto-seeding 12 products behind the scenes with no user input.

## Why

Current behavior (as of 2026-04-16):
- Onboarding has 3 steps: Clínica → Procedimentos → Equipe.
- When the wizard completes, the backend silently seeds 12 default products if the tenant has none.
- The defaults lean premium/international (Juvederm, Restylane, Sculptra, etc.) and miss Brazilian favorites like Botulift, Rennova Elleva, and Biogelis that are staples of the Brazilian HOF market.
- The user never sees the products or chooses what's relevant to their practice. Clinics that only do botox still get fillers and biostimulators cluttering dropdowns.

Desired behavior:
- Defaults reflect the Brazilian 2025 HOF market.
- The user sees and selects which products belong in their inventory from day one.
- The user can add clinic-specific products during onboarding (same pattern as the existing procedure types step).

## Non-Goals

- Changing the product schema.
- Seeding prices (clinic-specific, stays null).
- Importing a full ANVISA catalog — out of scope. The curated list is the minimum common set.
- Changing how products are managed post-onboarding (settings page stays as-is).

## New Default Catalog

`DEFAULT_PRODUCTS` in `web/src/lib/constants.ts` is replaced with this 12-entry list:

| Name | Category | Active Ingredient | Unit | Origin |
|------|----------|-------------------|------|--------|
| Botox Allergan 100U | botox | Toxina botulínica tipo A | U | Importado |
| Dysport 300U | botox | Toxina botulínica tipo A | U | Importado |
| Botulift 100U | botox | Toxina botulínica tipo A | U | Nacional |
| Juvederm Ultra XC | filler | Ácido hialurônico | mL | Importado |
| Juvederm Voluma XC | filler | Ácido hialurônico | mL | Importado |
| Restylane Lyft | filler | Ácido hialurônico | mL | Importado |
| Biogelis | filler | Ácido hialurônico | mL | Nacional |
| Sculptra | biostimulator | Ácido poli-L-láctico | mL | Importado |
| Rennova Elleva | biostimulator | Ácido poli-L-láctico | mL | Nacional |
| Radiesse | biostimulator | Hidroxiapatita de cálcio | mL | Importado |
| Restylane Skinbooster Vital | skinbooster | Ácido hialurônico | mL | Importado |
| Profhilo | skinbooster | Ácido hialurônico híbrido | mL | Importado |

The existing constant is augmented with an `origin: 'nacional' | 'importado'` field so the UI can badge Brazilian products. Origin is display-only — not stored on the `products` table.

## UI: New Onboarding Step

Step order becomes: **Clínica → Procedimentos → Produtos (new) → Equipe**.

### Layout

Follows the existing `procedure-types-step.tsx` pattern for visual consistency:

- Header: "Produtos" title + subtitle explaining these will populate inventory.
- Four grouped sections with category headers: **Toxina Botulínica**, **Preenchedores**, **Bioestimuladores**, **Skinboosters**.
- Each product rendered as a selectable card: checkbox + name + active ingredient subtitle + 🇧🇷 badge when `origin === 'nacional'`.
- **All defaults pre-selected.** User unchecks what they don't want.
- Bottom button: "+ Adicionar produto personalizado" — opens an inline form (same pattern as `CustomProcedureTypeForm`).
- Custom form fields: Nome (required), Categoria (Select with botox / filler / biostimulator / skinbooster / other), Princípio ativo (optional), Unidade (Select: U / mL).
- Added custom products render above the "+ Adicionar" button as selectable cards with a "remove" X.
- Standard "Voltar" / "Próximo" buttons in the wizard footer.

### Data flow

The step writes into the existing `OnboardingData` shape (extended):

```ts
interface ProductSelection {
  name: string
  category: string
  activeIngredient: string
  defaultUnit: string
  isCustom: boolean  // true only for user-added products
}

// New field on OnboardingData:
selectedProducts: ProductSelection[]
```

Pre-selection initializes from `DEFAULT_PRODUCTS`. Toggling a default adds/removes from the array. Custom products are pushed on save with `isCustom: true`.

## Backend Changes

### Validation

`web/src/validations/onboarding.ts` — extend the step 3 payload:

```ts
export const productSelectionSchema = z.object({
  name: z.string().min(1).max(150),
  category: z.enum(['botox', 'filler', 'biostimulator', 'skinbooster', 'peel', 'other']),
  activeIngredient: z.string().max(150).optional().default(''),
  defaultUnit: z.enum(['U', 'mL', 'unit', 'session']).default('U'),
})

// Added to the completion payload:
selectedProducts: z.array(productSelectionSchema).default([]),
```

### Seeding logic

`web/src/app/api/onboarding/route.ts` — replace the current unconditional default seeding:

```ts
// Before:
if (existingProducts.length === 0) {
  for (const p of DEFAULT_PRODUCTS) {
    await createProduct(tenantId, userId, p)
  }
}

// After:
if (existingProducts.length === 0 && data.selectedProducts.length > 0) {
  for (const p of data.selectedProducts) {
    await createProduct(tenantId, userId, {
      name: p.name,
      category: p.category,
      activeIngredient: p.activeIngredient || null,
      defaultUnit: p.defaultUnit,
    })
  }
}
```

Idempotency preserved: still only seeds when no products exist. If the user unchecks everything and adds no custom products, no products are seeded — they can add from settings later.

## Edge Cases

- **User skips step / unchecks everything:** no products seeded, user adds later from Configurações → Produtos.
- **User already has products from a previous attempt:** same idempotency guard — nothing happens (they keep what they have).
- **Duplicate custom name with a default:** allowed — the product table has no name uniqueness constraint per tenant; duplicates are the user's call.
- **Custom product validation fails server-side:** the whole onboarding POST fails with a field-level error; wizard stays on step 3 and highlights the bad custom entry.
- **Back navigation:** state survives via the same `useReducer` store that already backs the wizard.

## Files Affected

| File | Action |
|------|--------|
| `web/src/lib/constants.ts` | Modify — replace `DEFAULT_PRODUCTS` with the Brazilian-curated list + `origin` field |
| `web/src/validations/onboarding.ts` | Modify — add `productSelectionSchema` and `selectedProducts` to the step-3 payload |
| `web/src/components/onboarding/products-step.tsx` | Create — the new step UI |
| `web/src/components/onboarding/custom-product-form.tsx` | Create — inline form for custom products |
| `web/src/components/onboarding/onboarding-wizard.tsx` | Modify — wire new step into the flow (increment step count, update progress bar, insert between procedures and team) |
| `web/src/hooks/use-onboarding.ts` (or equivalent reducer) | Modify — extend state with `selectedProducts` |
| `web/src/app/api/onboarding/route.ts` | Modify — read `selectedProducts` from payload, seed from it instead of the static default list |
| `web/src/components/onboarding/__tests__/products-step.test.tsx` | Create — cover default pre-selection, toggle, custom add/remove, submission shape |

## Not In Scope

- Product pricing in onboarding (default prices stay null, user sets later).
- Selling/enforcing a particular product inventory.
- Editing existing products during onboarding.
- `logoUrl`, financial settings, consent template review, or any other onboarding gaps — those are separate specs.
- Changing the products table schema.
