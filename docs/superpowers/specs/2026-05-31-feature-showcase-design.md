# Feature Showcase Component

## Goal

Replace the current 3×3 feature card grid on the landing page with an interactive auto-cycling showcase. Each feature group becomes a tabbed block with animated SVG demos, giving visitors a feel for the product without real screenshots.

## Layout

### Desktop (md+)

Side tabs layout per feature group:

```
┌──────────────────────────────────────────────────┐
│  ╌╌╌ GROUP LABEL PILL ╌╌╌                        │
│                                                  │
│  ┌─────────────────┐  ┌────────────────────────┐ │
│  │ ▌ Feature 1  ◄──│  │                        │ │
│  │   description    │  │   Animated SVG Demo    │ │
│  │   ████░░░░ 65%   │  │                        │ │
│  │                  │  │   (loops on 4s cycle)  │ │
│  │   Feature 2      │  │                        │ │
│  │   description    │  │                        │ │
│  │                  │  │                        │ │
│  │   Feature 3      │  │                        │ │
│  │   description    │  └────────────────────────┘ │
│  └─────────────────┘                              │
└──────────────────────────────────────────────────┘
```

- Left panel: ~240px wide, vertical tab list
- Active tab: sage/10 background, left border accent (3px sage), title + description + timer bar
- Inactive tabs: no background, muted text, title + description only
- Right panel: flex-1, contains the animated SVG demo (aspect ~16:10)
- Timer bar: 5s fill animation, linear, sage color on sage/10 track

### Mobile (<md)

Accordion stack:

```
┌──────────────────────────┐
│  ╌╌╌ GROUP LABEL ╌╌╌     │
│                          │
│  ┌──────────────────────┐│
│  │ ┌──────────────────┐ ││
│  │ │ Animated SVG Demo │ ││
│  │ └──────────────────┘ ││
│  │ Feature 1             ││
│  │ description           ││
│  │ ████░░░░░░░ 65%       ││
│  └──────────────────────┘│
│                          │
│  ┌──────────────────────┐│
│  │ Feature 2      (dim)  ││
│  └──────────────────────┘│
│                          │
│  ┌──────────────────────┐│
│  │ Feature 3      (dim)  ││
│  └──────────────────────┘│
└──────────────────────────┘
```

- Active feature: expanded card with demo + title + description + timer bar
- Collapsed features: title only, muted opacity
- Tapping a collapsed feature selects it and resets timer

## Behavior

- **Auto-cycle**: advances to next feature every 5 seconds
- **Timer bar**: linear fill animation (0% to 100% over 5s), resets on switch
- **Pause on hover** (desktop) or **pause on touch** (mobile)
- **Click/tap a tab**: switches immediately, resets timer
- **Loops**: after last feature, wraps to first
- **Animations**: each SVG demo loops on a 4s cycle (1s static "complete" state before auto-advance)

## Animated SVG Demos

All animations are inline SVG with CSS keyframes. No external dependencies. Each uses the site palette (sage, forest, cream, mint).

### Group 1: Precisão Clínica Visual

1. **Diagrama Facial**: Face oval outline. Injection dots appear one by one (staggered 0.5s delays) at forehead, cheeks, jawline, lips. Small labels fade in next to each dot. Loop: dots and labels fade out, restart.

2. **Antes e Depois**: Two rectangular photo frames (left: "antes", right: "depois") with simplified face silhouettes. Frames slide toward center, alignment grid lines appear between them, then a "lock" icon pulses. Loop: frames slide apart, restart.

3. **Captura Guiada**: Camera viewfinder rectangle. Oval face guide in center (dashed). A face outline enters from below, moves into position inside the oval. Oval turns green, flash effect. Loop: face exits, restart.

### Group 2: Fluxo sem Atrito

4. **Atendimento Guiado**: Horizontal step flow — 5 small circles connected by lines (anamnese, avaliação, planejamento, aprovação, execução). Checkmarks fill circles left to right with 0.6s stagger. Active circle has a pulse ring. Loop: checkmarks fade, restart.

5. **Assinatura Digital**: Phone outline with document inside. A signature line draws itself (cursive path animation using stroke-dashoffset). Green checkmark appears at bottom. Loop: signature erases, restart.

6. **Anamnese Self-service**: Phone outline with form. Input fields highlight one by one from top to bottom (simulating typing with growing rectangles). Submit button at bottom pulses green when all fields are "filled". Loop: fields clear, restart.

### Group 3: Gestão do Negócio

7. **Financeiro**: Mini bar chart (4 bars) with bars growing from bottom. A total number counts up above the chart. Below, 3 installment dots fill in with checkmarks. Loop: bars shrink, restart.

8. **Pacotes**: A package card outline. Inside, a row of 5 session dots. Dots fill in one by one (3 of 5 filled = "3/5 sessões"). A progress bar below mirrors the fill. Loop: dots empty, restart.

9. **Agenda + Calendar**: 7-column calendar grid (one week). Appointment blocks fade in at various positions. A Google "G" icon appears with a bi-directional arrow, pulsing to indicate sync. Loop: blocks fade out, restart.

## Component Architecture

### Files

- `site/src/components/feature-showcase.tsx` — Main component: manages active tab state, timer, auto-cycle logic. Renders `FeatureShowcaseGroup` for each group.
- `site/src/components/feature-demos.tsx` — All 9 animated SVG demo components. Each is a self-contained SVG with CSS keyframe animations defined inline via `<style>` tags scoped with unique class prefixes.

### Props

```tsx
interface FeatureShowcaseProps {
  groups: {
    label: string
    features: {
      title: string
      description: string
      demo: React.ComponentType
    }[]
  }[]
}
```

### State Management

- `activeGroup` is not needed — each group renders independently on the page
- Per group: `activeIndex` (0-2), managed by `useState`
- Timer: `useEffect` with `setInterval(5000)`, clears on hover/touch, restarts on leave
- Animation reset: keyed re-mount of demo component when `activeIndex` changes (use `key={activeIndex}`)

### Integration

In `page.tsx`, the current `<Features />` component is replaced by `<FeatureShowcase />`. The group labels, feature titles, and descriptions remain the same — only the presentation changes from cards to showcase.

## Accessibility

- Tab list uses `role="tablist"` / `role="tab"` / `role="tabpanel"`
- `aria-selected` on active tab
- Timer pauses when tab panel receives focus
- `prefers-reduced-motion`: disables auto-cycle and SVG animations, shows static SVG states
- All SVG demos have `aria-hidden="true"` (decorative)
