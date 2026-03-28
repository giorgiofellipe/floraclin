# FloraClin Brand Tokens

Reference for all agents building UI components.

## Colors (Tailwind classes)

| Token | Hex | Tailwind | Usage |
|-------|-----|----------|-------|
| Forest | #1C2B1E | `bg-forest`, `text-forest` | Primary, sidebar bg, buttons, headings |
| Sage | #4A6B52 | `bg-sage`, `text-sage` | Secondary, active states, success text |
| Mint | #8FB49A | `bg-mint`, `text-mint` | Accent, success indicators, logo "Clin" |
| Blush | #E8D5C8 | `bg-blush`, `text-blush` | Warm support, stat card backgrounds |
| Petal | #F2E8E1 | `bg-petal`, `text-petal` | Light background, completed status |
| Cream | #FAF7F3 | `bg-cream`, `text-cream` | Base background, sidebar text |
| Charcoal | #2A2A2A | `text-charcoal` | Primary text |
| Mid | #7A7A7A | `text-mid` | Secondary text |
| Gold | #C4A882 | `text-gold`, `bg-gold` | Premium details |
| Amber | #D4845A | `text-amber`, `bg-amber` | Attention, pending payments, CTAs |
| Amber Light | #F5E6DE | `bg-amber-light` | Warning backgrounds |
| Amber Mid | #E8A882 | `text-amber-mid` | Warning medium |
| Amber Dark | #A85A32 | `text-amber-dark` | Warning text on light bg |

## Typography

| Role | Font | Tailwind | Usage |
|------|------|----------|-------|
| Logo only | Cormorant Garamond | `font-display` | "FloraClin" brand name only |
| Everything else | Jost | `font-sans` (default) | Headings, body, labels, nav, buttons |
| Eyebrow | Jost uppercase | `uppercase tracking-wider text-sm` | Labels, section headers |

## Status Colors

| Status | Background | Text |
|--------|-----------|------|
| Scheduled | `bg-sage/10` | `text-sage` |
| Confirmed | `bg-mint/20` | `text-forest` |
| In Progress | `bg-amber-light` | `text-amber-dark` |
| Completed | `bg-petal` | `text-mid` |
| Cancelled | `bg-red-100` | `text-red-800` |
| No Show | `bg-amber-light` | `text-amber-dark` |

## Semantic Usage

- **Buttons primary:** `bg-forest text-cream hover:bg-sage`
- **Buttons secondary:** `border-forest text-forest hover:bg-petal`
- **Active nav:** `bg-sage/20 text-cream`
- **Success:** Sage or Mint
- **Warning/Pending:** Amber
- **Error:** Red (standard)
- **Page backgrounds:** `bg-cream`
- **Card backgrounds:** `bg-white` or `bg-petal` for highlighted
- **Sidebar:** `bg-forest` with `text-cream/70` items
- **Logo:** "Flora" in Forest/Cream, "Clin" in Sage/Mint
- **Page titles:** `font-display text-forest`
- **Form labels:** `uppercase tracking-wider text-sm`

## Don'ts

- Don't use emerald, gray-50, or default Tailwind greens
- Don't use Amber for errors — use red
- Don't use Amber for success — use Sage/Mint
- Don't use Amber on more than 10% of a screen
- Don't use display font (Cormorant Garamond) for body text or UI elements
