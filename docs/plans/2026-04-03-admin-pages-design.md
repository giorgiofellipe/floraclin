# Admin Pages Design

## Scope

Platform-level admin pages for managing all tenants, users, and impersonation. Only visible to users with `isPlatformAdmin: true`.

## Navigation & Access

- New "Plataforma" section at the bottom of the sidebar, visible only when `isPlatformAdmin`
- Two links: **Clínicas** (`/admin/clinicas`) and **Usuários** (`/admin/usuarios`)
- Sidebar autocomplete for quick tenant impersonation (type clinic name → switch)
- API routes under `/api/admin/*` check `isPlatformAdmin`, return 403 otherwise
- `getAuthContext()` returns `isPlatformAdmin: boolean` in the response

## Impersonation

- Autocomplete input in the sidebar "Plataforma" section
- Type clinic name → dropdown shows matching tenants → click → sets `floraclin_tenant_id` cookie → page reloads
- When impersonating: shows clinic name with green dot + "X" to clear
- Header banner: "Visualizando como [Clinic Name]" with "Encerrar" button
- Clearing resets to admin's own tenant

## Clínicas Page (`/admin/clinicas`)

Card-based list showing all tenants:
- Name, slug, created date, user count, status (active/inactive)
- Search by name/slug
- "Nova Clínica" button → dialog with: name, slug (auto-generated), owner email

Card actions:
- Editar — edit name, slug, settings
- Desativar/Ativar — soft toggle
- Inline-expandable detail showing:
  - Tenant settings (onboarding, online booking, etc.)
  - Users in that tenant with roles
  - Quick stats: patient count, financial entries count

## Usuários Page (`/admin/usuarios`)

Card-based list showing all platform users:
- Name, email, phone, created date
- Tenant badges (which clinics + role in each)
- Search by name/email
- "Novo Usuário" button → creates user + assigns to tenant with role

Card expands inline showing:
- All tenant memberships (clinic name + role + active status)
- Add to tenant — assign user to another clinic with role
- Remove from tenant — remove membership
- Reset password — triggers Supabase password reset email
- Toggle isPlatformAdmin — promote/demote

No user deletion — deactivate memberships only.

## Data Model

No schema changes needed:
- `users.isPlatformAdmin` already exists
- `tenants` table has all clinic data
- `tenant_users` handles memberships
- Impersonation uses existing `floraclin_tenant_id` cookie mechanism

## API Routes

- `GET /api/admin/tenants` — list all tenants with user counts
- `POST /api/admin/tenants` — create tenant + owner user
- `PUT /api/admin/tenants/[id]` — update tenant
- `GET /api/admin/users` — list all users with memberships
- `POST /api/admin/users` — create user + assign to tenant
- `PUT /api/admin/users/[id]` — update user (isPlatformAdmin toggle)
- `POST /api/admin/users/[id]/reset-password` — trigger password reset
- `POST /api/admin/users/[id]/memberships` — add to tenant
- `DELETE /api/admin/users/[id]/memberships/[tenantId]` — remove from tenant
- `POST /api/admin/impersonate` — set tenant cookie
- `POST /api/admin/impersonate/clear` — clear impersonation
