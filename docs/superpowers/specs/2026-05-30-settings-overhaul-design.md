# Settings Page Overhaul

## Goal

Reorganize the settings page (`/configuracoes`) with grouped sidebar navigation, URL-based tab state, and human-readable WhatsApp template labels.

## Changes

### 1. Sidebar Grouping

Replace the flat 9-tab + 3-link layout with four semantic groups. All items become inline tabs — Pacotes, Documentos, and Perfil are no longer separate routes.

**Group: Geral**
- Clínica (`clinica`) — `BuildingIcon`
- Equipe (`equipe`) — `UsersIcon`
- Perfil (`perfil`) — `UserCogIcon`

**Group: Clínico**
- Procedimentos (`procedimentos`) — `SyringeIcon`
- Produtos (`produtos`) — `PackageIcon`
- Pacotes (`pacotes`) — `Package2Icon`
- Contratos e Termos (`termos`) — `FileTextIcon`
- Documentos (`documentos`) — `ClipboardSignatureIcon`

**Group: Operações**
- Agendamento (`agendamento`) — `CalendarIcon`
- Financeiro (`financeiro`) — `DollarSignIcon`
- WhatsApp (`whatsapp`) — `MessageCircleIcon`

**Group: Sistema**
- Auditoria (`auditoria`) — `ShieldCheckIcon`

Desktop sidebar renders group labels as small uppercase section headers (font-size 10px, letter-spacing, muted color). No dividers between groups — the labels provide visual separation.

Mobile horizontal scroll bar keeps flat ordering (Clínica, Equipe, Perfil, Procedimentos, Produtos, Pacotes, Contratos e Termos, Documentos, Agendamento, Financeiro, WhatsApp, Auditoria) — group labels are omitted since the scrollable bar has no room for them.

### 2. URL Tab Params

Mirror the patient detail page pattern (`useSearchParams` + `router.replace`):

- URL format: `/configuracoes?tab=<key>` (e.g. `?tab=whatsapp`)
- Default tab: `clinica` (no `?tab=` param needed)
- Tab changes call `router.replace` with `{ scroll: false }` — no history entry per tab switch
- Server component (`page.tsx`) reads `searchParams.tab` and passes it to the client component
- Client component initializes from the URL param, falls back to `clinica` if invalid/missing

Tab keys: `clinica`, `equipe`, `perfil`, `procedimentos`, `produtos`, `pacotes`, `termos`, `documentos`, `agendamento`, `financeiro`, `whatsapp`, `auditoria`.

### 3. Convert Link Items to Inline Tabs

The three pages that currently have dedicated sub-routes become inline tab content:

**Pacotes** (`configuracoes/pacotes/`):
- Currently renders `PacotesPageClient` (no props, fetches data internally)
- Requires `owner` role — render the component when `activeTab === 'pacotes'`

**Documentos** (`configuracoes/documentos/`):
- Currently renders `DocumentosPageClient` (no props, fetches data internally)
- Requires `owner` or `practitioner` role — render when `activeTab === 'documentos'`

**Perfil** (`configuracoes/perfil/`):
- Currently renders `PerfilPageClient` with `userRole` prop
- Available to all authenticated users — render when `activeTab === 'perfil'`
- `userRole` must be passed from the settings page server component

The old sub-route directories (`pacotes/`, `documentos/`, `perfil/`) should be deleted after migration. No redirects needed — these are internal app pages, not public URLs.

### 4. WhatsApp Template Label Display

In `whatsapp-template-list.tsx`, swap the title and subtitle:

**Before:**
- Title: raw Meta name (`clinica_floraclin_anamnese_link`)
- Subtitle: purpose label (`Link de anamnese`)

**After:**
- Title: purpose label from `PURPOSE_LABELS[t.purposeKey]` (e.g. `Link de anamnese`)
- Subtitle: raw Meta name (`clinica_floraclin_anamnese_link`)
- Fallback: if no `purposeKey`, keep raw name as title (no subtitle)

### 5. Role-Based Tab Visibility

The settings page currently requires `owner` role. Since Perfil (any role) and Documentos (`owner` + `practitioner`) are being inlined, the page gate must relax:

- `page.tsx` uses `getAuthContext()` instead of `requireRole('owner')` — any authenticated user can access `/configuracoes`
- Tabs have optional `requiredRoles` (same pattern as patient tabs):
  - **No restriction** (visible to all): Perfil
  - **owner + practitioner**: Documentos
  - **owner only**: all other tabs (Clínica, Equipe, Procedimentos, Produtos, Pacotes, Termos, Agendamento, Financeiro, WhatsApp, Auditoria)
- If a user navigates to `/configuracoes?tab=financeiro` but lacks the `owner` role, fall back to `perfil`
- Non-owner users see a shorter sidebar with only the tabs they can access

## Data Flow

The `configuracoes-page-client.tsx` wrapper already fetches tenant, procedureTypes, products, members, and consentTemplates. Additional data needs:

- `userRole`: from `getAuthContext()` in `page.tsx` — pass to client component for role-based tab filtering and Perfil tab
- Pacotes and Documentos: self-contained client components that fetch their own data via hooks
- Server-side data fetches (tenant, procedureTypes, etc.) should be gated on role — only fetch when the user is `owner`, since non-owners won't see those tabs

## Architecture

No new components. Changes are confined to:

1. `settings-page-client.tsx` — new `TABS` structure with groups, URL param handling, role-based filtering, new tab content panels
2. `configuracoes-page-client.tsx` — pass `userRole` prop, gate data fetches on role
3. `page.tsx` — use `getAuthContext()` instead of `requireRole('owner')`, read `searchParams.tab`, pass `userRole`
4. `whatsapp-template-list.tsx` — swap title/subtitle rendering
5. Delete: `configuracoes/pacotes/`, `configuracoes/documentos/`, `configuracoes/perfil/` directories
