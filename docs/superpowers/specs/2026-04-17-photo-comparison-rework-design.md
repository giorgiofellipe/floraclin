# Photo Comparison Rework — Design

## Goal

Replace the dropdown-based photo comparison flow with a touch-friendly selection from the existing photo grid + a fullscreen dark dialog for the comparison viewer. Optimized for iPad clinical workflow.

## Current State

- `photo-comparison.tsx` uses two `<Select>` dropdowns showing truncated filenames — impossible to identify photos visually
- Three comparison modes exist (side-by-side, overlay, slider) but display inline in a small card
- The comparison component is toggled via a separate "Comparar" button that shows/hides it above the grid
- Slider drag already supports touch events

## New Behavior

### Selection — comparison mode on the existing grid

1. User taps "Comparar" button → the photo grid enters **comparison mode**.
2. A banner appears at the top of the grid: `"Modo comparação — toque 2 fotos para comparar"` with a `"✕ Sair"` button.
3. Tapping a photo in the grid marks it as **A** (green border `#4A6B52` + "A" badge top-left).
4. Tapping another photo marks it as **B** (orange border `#D4845A` + "B" badge top-left).
5. Tapping a third photo replaces **B** with the new selection.
6. Tapping an already-selected photo deselects it (removes A or B).
7. Once both A and B are selected, the comparison dialog opens automatically.
8. Exiting comparison mode (via "✕ Sair") clears selections and returns to normal grid behavior.

### Display — fullscreen dark dialog

1. Opens automatically when A + B are both selected.
2. **Dark background** (`#1C2B1E`) for maximum image contrast — clinical-grade viewing.
3. **Slider mode as default** — user drags the divider with finger on iPad. The existing touch event handlers (`touchmove`, `touchend`) already support this.
4. **Top bar** with:
   - Mode tabs: `Slider` (default) | `Lado a Lado` | `Sobreposição`
   - Close button `✕` — returns to grid with selections preserved (can re-open or pick different photos)
5. **Photo labels** on each side showing stage + date (e.g., "Pré · 15 Mar 2026", "Pós 30d · 14 Abr 2026"). Uses the new `procedureTypeName` and `procedurePerformedAt` fields from the photos query.
6. **Opacity slider** for overlay mode (same as today, styled dark).
7. Dialog uses existing `Dialog` component with `sm:max-w-5xl` + custom dark theme classes.

## Changes

### 1. `patient-photos-tab.tsx`

- `comparisonMode` boolean state, toggled by "Comparar" button
- `selectedA` / `selectedB` state (photo IDs or null)
- `showComparison` boolean — true when both A and B are set
- Pass `comparisonMode`, `selectedA`, `selectedB`, `onPhotoSelect` callback to `PhotoGrid`
- Render `PhotoComparisonDialog` (new) when `showComparison` is true, passing both photo objects
- Remove the old inline `<PhotoComparison>` rendering

### 2. `photo-grid.tsx`

- Accept new optional props: `comparisonMode?: boolean`, `selectedA?: string | null`, `selectedB?: string | null`, `onPhotoSelect?: (photo: PhotoAssetWithUrl) => void`
- When `comparisonMode` is true:
  - Render the banner at top
  - Photo tap calls `onPhotoSelect` instead of the zoom dialog
  - Selected photos get colored border + letter badge overlay
- When `comparisonMode` is false: existing behavior (zoom/annotate/delete actions)

### 3. `photo-comparison.tsx` → rewrite as `PhotoComparisonDialog`

- Rewrite as a `Dialog`-based fullscreen dark viewer
- Props: `open`, `onOpenChange`, `photoA: PhotoAssetWithUrl`, `photoB: PhotoAssetWithUrl`
- Fetches signed comparison URLs internally (same `/api/photos?photoIdA=&photoIdB=` endpoint)
- Three modes: slider (default), side-by-side, overlay
- Dark theme: bg `#1C2B1E`, white text, translucent controls
- Labels show `photoA.procedureTypeName + date` and `photoB.procedureTypeName + date` (falls back to stage label if no procedure linked)
- Keep existing slider drag logic (mouse + touch handlers)

### 4. No API changes

The `/api/photos` endpoint already supports `?photoIdA=&photoIdB=` for fetching comparison signed URLs. The `PhotoAssetWithUrl` type already includes `procedureTypeName` and `procedurePerformedAt` from the earlier photos-procedure-grouping work.

## Non-goals

- No new photo upload flow
- No changes to the annotation feature
- No changes to DB schema
- Not changing the photo grid grouping (already done in this branch)
