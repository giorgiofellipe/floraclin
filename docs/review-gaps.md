# FloraClin MVP — Gap Review Report

**Date:** 2026-03-27
**Compared:** Implementation plan + design doc vs. actual codebase

---

## 1. MISSING FEATURES (Planned but not implemented)

### 1.1 Reception Queue View
The design doc specifies a "Simple reception queue view" under Scheduling Module (section 4). No queue component or page exists. The scheduling module has day/week/month calendar views but no dedicated reception/waiting-room view showing today's patients by arrival status.

### 1.2 Clinic Name Not Displayed in Sidebar
The plan (Task 4, Step 2) specifies the sidebar should display `clinicName`. The `Sidebar` component accepts `clinicName` as a prop but ignores it (line 59: `// eslint-disable-next-line @typescript-eslint/no-unused-vars`). The sidebar logo area only shows "FloraClin" branding. The clinic name should appear below the logo or as a subtitle.

### 1.3 Onboarding Wizard Has 3 Steps Instead of 4
The i18n file defines 4 steps: (1) Clinic data, (2) Working hours, (3) Procedure types, (4) Invite team. The implementation merges steps 1 and 2 into a single "Clinica" step, resulting in a 3-step wizard (Clinica, Procedimentos, Equipe). This is a reasonable design choice but deviates from the plan's i18n strings.

### 1.4 Tenant Switcher UI
The plan (Task 3, Step 3 — `src/lib/auth.ts`) includes `getUserTenants()` and `setActiveTenant()` helpers for users belonging to multiple tenants. However, no tenant-switcher UI component exists in the sidebar or header for switching between clinics.

### 1.5 Follow-up Scheduling Linked to Procedures
The design doc mentions "Follow-up scheduling linked to procedures" as a feature. The procedure form captures a `followUpDate` field, and the dashboard shows `upcomingFollowUps`, but there is no automatic appointment creation from follow-up dates, nor a button to create an appointment directly from a follow-up.

### 1.6 Platform Admin Features
The design doc defines a "Platform Admin" role with cross-tenant capabilities (manage tenants, impersonate users, view platform metrics). No platform admin pages, impersonation UI, or admin routes exist. The `is_platform_admin` field exists in the schema but is unused in the UI.

---

## 2. TYPESCRIPT ERRORS

**Result: CLEAN** — `npx tsc --noEmit` completes with zero errors.

---

## 3. STALE EMERALD/GRAY COLOR REFERENCES

**Result: CLEAN** — No `emerald-` or `gray-` Tailwind class references found anywhere in `src/`. All colors use the custom brand palette (forest, sage, mint, blush, petal, cream, charcoal, mid, gold, amber) defined in `globals.css`, plus shadcn semantic tokens (muted, foreground, border, etc.).

---

## 4. BROKEN IMPORTS / MISSING DEPENDENCIES

**Result: CLEAN** — TypeScript compiles without errors, which means all imports resolve correctly and all type dependencies are satisfied.

---

## 5. ROUTE VERIFICATION

All planned routes have corresponding `page.tsx` files:

| Route | Status | File |
|---|---|---|
| `/login` | OK | `src/app/(auth)/login/page.tsx` |
| `/reset-password` | OK | `src/app/(auth)/reset-password/page.tsx` |
| `/dashboard` | OK | `src/app/(platform)/dashboard/page.tsx` |
| `/agenda` | OK | `src/app/(platform)/agenda/page.tsx` |
| `/pacientes` | OK | `src/app/(platform)/pacientes/page.tsx` |
| `/pacientes/[id]` | OK | `src/app/(platform)/pacientes/[id]/page.tsx` |
| `/pacientes/[id]/procedimentos/[procedureId]` | OK | `src/app/(platform)/pacientes/[id]/procedimentos/[procedureId]/page.tsx` |
| `/financeiro` | OK | `src/app/(platform)/financeiro/page.tsx` |
| `/configuracoes` | OK | `src/app/(platform)/configuracoes/page.tsx` |
| `/onboarding` | OK | `src/app/onboarding/page.tsx` |
| `/c/[slug]` (public booking) | OK | `src/app/c/[slug]/page.tsx` |
| `/api/auth/me` | OK | `src/app/api/auth/me/route.ts` |
| `/api/book/[slug]` | OK | `src/app/api/book/[slug]/route.ts` |
| `/api/book/[slug]/slots` | OK | `src/app/api/book/[slug]/slots/route.ts` |

---

## 6. FEATURE CHECKLIST

### Patient Module
- [x] Patient CRUD (create, read, update, delete)
- [x] Patient search (search bar in patient list)
- [x] Patient list with pagination
- [x] Patient detail page
- [x] 7 tabs: Dados, Anamnese, Procedimentos, Fotos, Termos, Financeiro, Timeline

### Anamnesis Module
- [x] All sections present: main complaint, patient goals, medical history, medications, allergies, previous surgeries, chronic conditions, pregnancy/breastfeeding, lifestyle, skin type (Fitzpatrick), skin conditions, skincare routine, previous treatments, contraindications, facial evaluation

### Procedure Module
- [x] Procedure form with collapsible sections
- [x] Face diagram editor with freeform point placement
- [x] Photo uploader integrated into procedure form
- [x] Consent viewer with checkbox + signature pad
- [x] Product applications with batch/lot numbers
- [x] Follow-up date and next session objectives

### Face Diagram
- [x] SVG templates exist: `public/face-templates/front.svg`, `left-profile.svg`, `right-profile.svg`
- [x] 3 views: front, left profile, right profile
- [x] Freeform point placement with click coordinates
- [x] Per-point product/quantity/technique tracking
- [x] Auto-sum totals via `DiagramSummary`
- [x] Ghost overlay of previous session points

### Photo Module
- [x] Upload via `PhotoUploader`
- [x] Grid display with timeline stage labels
- [x] Annotation editor with Fabric.js (pencil, arrow, text, eraser)
- [x] Undo/redo in annotation editor
- [x] Comparison with 3 modes: side-by-side, overlay (opacity slider), slider

### Consent Module
- [x] Consent viewer with scrollable content
- [x] Checkbox acceptance
- [x] Signature pad via `react-signature-canvas`
- [x] Template versioning (version badge displayed)
- [x] Consent template management in settings
- [x] Consent history component

### Scheduling Module
- [x] Day view
- [x] Week view
- [x] Month view
- [x] Practitioner filter
- [x] Appointment form (create/edit)
- [x] Navigation (prev/next/today)
- [ ] Reception queue view (MISSING)

### Financial Module
- [x] Financial list (accounts receivable)
- [x] Payment form with payment methods (pix, card, cash, transfer)
- [x] Installment table with per-installment tracking
- [x] Revenue overview chart (bar chart + pie chart via Recharts)

### Public Booking
- [x] Public page at `/c/[slug]`
- [x] Practitioner selection
- [x] Slot picker
- [x] Booking API routes

### Onboarding
- [x] Wizard with stepper UI
- [x] Step 1: Clinic settings (includes working hours)
- [x] Step 2: Procedure types (default suggestions + custom)
- [x] Step 3: Invite team
- [x] Onboarding enforcement in platform layout (redirects to `/onboarding` if not completed)

### Dashboard
- [x] Greeting with time-of-day
- [x] Quick stats cards
- [x] Today's appointments
- [x] Upcoming follow-ups
- [x] Recent activity feed
- [x] Quick action buttons (new patient, new appointment)

### Settings
- [x] Clinic tab (name, phone, email, address, working hours)
- [x] Procedures tab (CRUD for procedure types)
- [x] Team tab (list members, invite users, role management)
- [x] Consent templates tab (CRUD)
- [x] Booking settings tab (enable/disable online booking, slug preview)
- [x] Audit log viewer tab (filterable table with pagination)

### Ship-Blocker Polish
- [x] Loading states (skeleton) for: pacientes, pacientes/[id], dashboard, agenda, financeiro, configuracoes
- [x] Empty states for: patient list, procedure list, photo grid, financial list, calendar, consent history, team list, follow-ups, recent activity, audit logs
- [x] Mobile sidebar (Sheet triggered by hamburger in header, closes on navigation)
- [x] Page metadata (`<title>`) on all pages
- [x] Error boundaries: `(auth)/error.tsx` and `(platform)/error.tsx`

---

## 7. SUMMARY

The MVP implementation is remarkably complete. Out of the full plan, only a handful of gaps remain:

| Priority | Gap | Impact |
|---|---|---|
| Low | Reception queue view not implemented | Nice-to-have for receptionists; they can use day view instead |
| Low | Clinic name not shown in sidebar | Cosmetic; easy fix |
| Low | Tenant switcher UI missing | Only matters for multi-tenant users |
| Low | Platform admin UI not built | Not needed for pilot clinic launch |
| Low | Onboarding has 3 steps instead of 4 | Functional; working hours merged into clinic step |
| Low | Follow-up to appointment automation | Follow-ups show on dashboard; manual booking still works |

**TypeScript: CLEAN** (zero errors)
**Brand colors: CLEAN** (no emerald/gray references)
**Imports: CLEAN** (no broken dependencies)
**Routes: COMPLETE** (all planned routes exist)
