# Admin Pages — Cook Plan

## Overview

Platform-level admin pages for managing tenants, users, and impersonation. Follows the established pattern: Zod validation, API route, DB query, React Query hook, component. Card-based UI (like `financial-list.tsx`), not tables.

## Group 0 — Foundation (parallel, no dependencies)

### Task 0A: AuthContext + isPlatformAdmin
**Modifies:** `src/types/index.ts`, `src/lib/auth.ts`

- Add `isPlatformAdmin: boolean` to `AuthContext` type
- In `getAuthContext`, select `users.isPlatformAdmin` in the memberships query
- Return `isPlatformAdmin` in the context object
- Add `requirePlatformAdmin()` helper that calls `getAuthContext()` and throws 403 if not admin
- **Security fix:** In `getAuthContext`, when resolving active tenant from cookie, verify the user either (a) has an active membership in that tenant, OR (b) is a platform admin. Currently falls back silently — make this explicit.

### Task 0B: Admin Zod Validations
**Creates:** `src/validations/admin.ts`

Schemas:
- `adminSearchSchema` — `{ search?: string, page?: number, limit?: number }`
- `createTenantSchema` — `{ name: string, slug?: string, ownerEmail: string, ownerName: string }`
- `updateTenantSchema` — `{ name?: string, slug?: string, settings?: object, isActive?: boolean }`
- `createAdminUserSchema` — `{ email: string, fullName: string, phone?: string, tenantId: string, role: enum }`
- `updateAdminUserSchema` — `{ fullName?: string, phone?: string, isPlatformAdmin?: boolean }`
- `addMembershipSchema` — `{ tenantId: string, role: enum }`
- `impersonateSchema` — `{ tenantId: string }`

### Task 0C: Admin DB Queries
**Creates:** `src/db/queries/admin-tenants.ts`, `src/db/queries/admin-users.ts`

**admin-tenants.ts:**
- `listAllTenants(search, page, limit)` — all tenants with user/patient/entry counts, search by name/slug
- `createTenantWithOwner(data)` — insert tenant, get-or-create user via Supabase admin (check `listUsers` first, create only if not exists), insert user + tenant_users. Handle duplicate email gracefully.
- `updateTenantAdmin(tenantId, data)` — update name/slug/settings/isActive
- `getTenantDetail(tenantId)` — tenant + users + stats

**admin-users.ts:**
- `listAllUsers(search, page, limit)` — all users with tenant memberships
- `createUserWithMembership(data)` — invite via Supabase admin, insert user + tenant_users
- `updateUserAdmin(userId, data)` — update fullName, phone, isPlatformAdmin
- `addUserMembership(userId, tenantId, role)` — insert tenant_users
- `removeUserMembership(userId, tenantId)` — set isActive=false. Guard: refuse if it's the user's last active membership (throw error).
- `resetUserPassword(email)` — call Supabase admin resetPasswordForEmail

### Task 0D: Query Keys for Admin
**Modifies:** `src/hooks/queries/query-keys.ts`

Add `admin` namespace with `tenants` and `users` sub-keys.

## Group 1 — API Routes + Hooks (depends on Group 0)

### Task 1A: Tenant API Routes
**Creates:** `src/app/api/admin/tenants/route.ts`, `src/app/api/admin/tenants/[id]/route.ts`

GET (list) + POST (create) + PUT (update). All call `requirePlatformAdmin()`.

### Task 1B: User API Routes
**Creates:** `src/app/api/admin/users/route.ts`, `src/app/api/admin/users/[id]/route.ts`, `src/app/api/admin/users/[id]/reset-password/route.ts`, `src/app/api/admin/users/[id]/memberships/route.ts`, `src/app/api/admin/users/[id]/memberships/[tenantId]/route.ts`

### Task 1C: Impersonation API Routes
**Creates:** `src/app/api/admin/impersonate/route.ts`, `src/app/api/admin/impersonate/clear/route.ts`

POST to set/clear `floraclin_tenant_id` cookie. Both call `requirePlatformAdmin()`.

### Task 1D: Admin Query Hooks
**Creates:** `src/hooks/queries/use-admin-tenants.ts`, `src/hooks/queries/use-admin-users.ts`

### Task 1E: Admin Mutation Hooks
**Creates:** `src/hooks/mutations/use-admin-tenant-mutations.ts`, `src/hooks/mutations/use-admin-user-mutations.ts`, `src/hooks/mutations/use-impersonation.ts`

Impersonation hooks call `window.location.reload()` on success.

## Group 2 — Layout + Pages (depends on Group 1)

### Task 2A: Platform Layout + Sidebar
**Modifies:** `src/app/(platform)/layout.tsx`, `src/components/layout/sidebar.tsx`

- Layout: pass `isPlatformAdmin` + `impersonatingTenantName` to Sidebar/Header. **Skip onboarding redirect when `isPlatformAdmin` is true** (so admins can impersonate tenants that haven't completed onboarding).
- Sidebar: "Plataforma" section with admin links + tenant impersonation autocomplete
- When impersonating: show tenant name with green dot + X to clear

### Task 2B: Header Impersonation Banner
**Modifies:** `src/components/layout/header.tsx`

Amber banner: "Visualizando como [name]" + "Encerrar" button. Admin page title mappings.

### Task 2C: Admin Clinicas Page
**Creates:** `src/app/(platform)/admin/clinicas/page.tsx`, `src/components/admin/admin-tenant-list.tsx`, `src/components/admin/admin-tenant-dialog.tsx`

Card-based tenant list with search, create/edit dialog, inline expand with users + stats.

### Task 2D: Admin Usuarios Page
**Creates:** `src/app/(platform)/admin/usuarios/page.tsx`, `src/components/admin/admin-user-list.tsx`, `src/components/admin/admin-user-dialog.tsx`, `src/components/admin/admin-membership-dialog.tsx`

Card-based user list with search, create dialog, inline expand with memberships, password reset, admin toggle.

## File Ownership Matrix

| Group | Task | Creates | Modifies |
|-------|------|---------|----------|
| 0 | 0A | — | types/index.ts, lib/auth.ts |
| 0 | 0B | validations/admin.ts | — |
| 0 | 0C | db/queries/admin-tenants.ts, admin-users.ts | — |
| 0 | 0D | — | hooks/queries/query-keys.ts |
| 1 | 1A | api/admin/tenants/* | — |
| 1 | 1B | api/admin/users/* | — |
| 1 | 1C | api/admin/impersonate/* | — |
| 1 | 1D | hooks/queries/use-admin-*.ts | — |
| 1 | 1E | hooks/mutations/use-admin-*.ts, use-impersonation.ts | — |
| 2 | 2A | — | layout.tsx, sidebar.tsx |
| 2 | 2B | — | header.tsx |
| 2 | 2C | admin/clinicas/*, admin-tenant-*.tsx | — |
| 2 | 2D | admin/usuarios/*, admin-user-*.tsx, admin-membership-dialog.tsx | — |
