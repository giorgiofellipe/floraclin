# Auth Migration: Supabase Auth → Auth.js v5

## Motivation

Replace Supabase Auth with Auth.js v5 (NextAuth) to eliminate:
- Broken redirect URLs for password reset
- Token refresh failures ("Invalid Refresh Token")
- Middleware complexity
- Vendor lock-in on auth flow
- Lack of control over email templates

Keep Supabase for DB (PostgreSQL) and Storage (file uploads).

## Auth Providers

1. **Credentials** — email + bcrypt-hashed password
2. **Google OAuth** — via Auth.js Google provider
3. **Magic Link** — via Auth.js Email provider + Resend SMTP

## Database Changes

New tables in `floraclin` schema:

### `sessions`
- `id` uuid PK
- `sessionToken` varchar(255) UNIQUE
- `userId` uuid FK → users.id
- `expires` timestamp

### `accounts` (OAuth links)
- `id` uuid PK
- `userId` uuid FK → users.id
- `type` varchar (oauth, credentials)
- `provider` varchar (google, credentials)
- `providerAccountId` varchar
- `access_token` text
- `refresh_token` text
- `token_type` varchar
- `scope` varchar
- `id_token` text
- `expires_at` integer

### `verification_tokens` (magic links + password reset)
- `identifier` varchar (email)
- `token` varchar UNIQUE
- `expires` timestamp

### Modifications to `users`
- Add `passwordHash` text (nullable — OAuth/magic-link users won't have one)
- Add `emailVerified` timestamp (nullable — required by Auth.js)
- Keep existing `id`, `email`, `fullName`, `phone`, `isPlatformAdmin`, etc.

No changes to business tables (tenants, tenant_users, patients, financial_entries, etc.).

## Auth Flow

### Login Page (`/login`)
- Email + password form → `signIn("credentials", { email, password })`
- "Entrar com Google" button → `signIn("google")`
- "Entrar com link mágico" → email input → `signIn("email", { email })`
- "Esqueci minha senha" → magic link (same email provider)

### Password Reset
No separate flow. Magic link logs user in → change password in settings.
Eliminates the Supabase redirect URL problem entirely.

### Middleware
```typescript
// src/middleware.ts — replaces proxy.ts
export { auth as middleware } from "@/lib/auth"
```
Auth.js middleware checks session cookie. No token refresh complexity.

### `getAuthContext()` Changes
- Replace `supabase.auth.getUser()` with `auth()` from Auth.js (returns session)
- Rest unchanged: query tenant_users, resolve active tenant from cookie
- `isPlatformAdmin` logic unchanged

### Admin User Management
- `inviteUserByEmail` → insert user row + send magic link via Resend
- `resetPasswordForEmail` → send magic link
- Remove `@supabase/ssr` and `src/lib/supabase/admin.ts`

## Email Setup
- Provider: Resend (3,000 emails/month free)
- Domain: `floraclin.com.br` (custom sender)
- Templates: custom HTML for magic link and invite emails

## Files to Remove
- `src/lib/supabase/server.ts`
- `src/lib/supabase/middleware.ts`
- `src/proxy.ts`
- `@supabase/ssr` package dependency

## Files to Keep (modified)
- `src/lib/auth.ts` — rewrite to use Auth.js session
- `src/actions/auth.ts` — rewrite login/logout/reset
- `src/app/(auth)/login/page.tsx` — add Google + magic link buttons
- `src/middleware.ts` — new file, Auth.js export

## Files to Keep (unchanged)
- `src/db/client.ts` — Drizzle + postgres.js → Supabase DB
- `@supabase/supabase-js` — kept for Storage only
- All business logic (financial, scheduling, patients, etc.)

## Migration Path for Existing Users
1. Existing user IDs (UUIDs) stay as-is in `users.id`
2. Add `passwordHash` and `emailVerified` columns (both nullable)
3. On first login after migration:
   - If user has no `passwordHash` → prompt to set password or use magic link/Google
   - If user logs in via Google → create `accounts` row linking Google to existing user by email
4. No data migration needed for business tables

## New Dependencies
- `next-auth@5` (Auth.js v5)
- `@auth/drizzle-adapter`
- `bcryptjs` (password hashing)
- `resend` (email sending)

## Packages to Remove
- `@supabase/ssr`
- (keep `@supabase/supabase-js` for Storage)
