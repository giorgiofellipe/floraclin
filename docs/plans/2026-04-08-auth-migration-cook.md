# Auth Migration Cook Plan: Supabase Auth → Auth.js v5

## Group 0 — Dependencies (sequential prerequisite)

### Task 0.1: Install packages
**Modifies:** `package.json`, `pnpm-lock.yaml`
- Add: `next-auth@5`, `@auth/drizzle-adapter`, `bcryptjs`, `@types/bcryptjs`
- Remove: `@supabase/ssr`
- Keep: `@supabase/supabase-js` (Storage), `resend` (already present)

### Task 0.2: Environment variables
**Modifies:** `.env.local`
- Add: `NEXTAUTH_SECRET`, `NEXTAUTH_URL=http://localhost:3000`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM=noreply@floraclin.com.br`

## Group 1 — Schema (depends on Group 0)

### Task 1.1: Add auth tables + user columns to Drizzle schema
**Modifies:** `src/db/schema.ts`
- Add `passwordHash` and `emailVerified` columns to `users` table
- Create `sessions` table (id, sessionToken, userId, expires)
- Create `accounts` table (id, userId, type, provider, providerAccountId, tokens...)
- Create `verificationTokens` table (identifier, token, expires)
- All in `floraclinSchema`

### Task 1.2: Generate + apply migration
**Creates:** `src/db/migrations/0006_*.sql`
- ALTER TABLE floraclin.users ADD COLUMN password_hash text, email_verified timestamptz
- CREATE TABLE floraclin.sessions, accounts, verification_tokens

## Group 2 — Core Auth (depends on Group 1, all 4 parallel)

### Task 2.1: Auth.js config + rewrite getAuthContext
**Creates:** `src/lib/auth-config.ts`
**Modifies:** `src/lib/auth.ts`
- Auth.js config: Drizzle adapter, Credentials + Google + Email providers
- Session strategy: "database"
- Rewrite getAuthContext to use `auth()` instead of `supabase.auth.getUser()`
- Keep setActiveTenant, getUserTenants, requireRole, requirePlatformAdmin signatures

### Task 2.2: Email provider (Resend)
**Creates:** `src/lib/email.ts`
- sendMagicLinkEmail(email, url)
- sendInviteEmail(email, url)
- Custom HTML templates in Portuguese

### Task 2.3: New middleware
**Creates:** `src/middleware.ts`
- Auth.js middleware with route protection
- Public: /c/*, /api/book/*, /api/auth/*
- Auth pages: /login, /reset-password
- Test bypass: preserve x-test-user-id header logic

### Task 2.4: Standalone storage client
**Creates:** `src/lib/supabase/storage-client.ts`
**Modifies:** `src/lib/storage.ts`
- Decouple storage from auth — use @supabase/supabase-js directly with service role key

## Group 3 — Rewrites (depends on Group 2, all 5 parallel)

### Task 3.1: Auth server actions
**Modifies:** `src/actions/auth.ts`
- login → signIn("credentials") or signIn("google") or signIn("email")
- logout → signOut()
- resetPassword → signIn("email") (magic link)
- switchTenant → use auth() session

### Task 3.2: Admin user queries
**Modifies:** `src/db/queries/admin-users.ts`
- createUserWithMembership: direct DB insert + bcrypt + Resend invite
- resetUserPassword: verification token + Resend magic link
- Remove all createAdminClient() imports

### Task 3.3: Admin tenant queries
**Modifies:** `src/db/queries/admin-tenants.ts`
- createTenantWithOwner: direct DB insert + Resend invite
- Remove all createAdminClient() imports

### Task 3.4: Tenant user invite
**Modifies:** `src/db/queries/users.ts`
- inviteUser: direct DB insert + Resend invite (if this function exists)
- Remove createAdminClient() import

### Task 3.5: Auth.js API route
**Creates:** `src/app/api/auth/[...nextauth]/route.ts`
- Export GET, POST from auth-config handlers

## Group 4 — Frontend (depends on Group 3, parallel)

### Task 4.1: Login page
**Modifies:** `src/app/(auth)/login/page.tsx`
- Keep email+password form
- Add "Entrar com Google" button
- Add "Entrar com link mágico" email input
- "Esqueci minha senha" → triggers magic link

### Task 4.2: Reset password page
**Modifies:** `src/app/(auth)/reset-password/page.tsx`
- Simplify to "check your email" confirmation
- Or replace with password-change form (for logged-in users who want to set/change password)

## Group 5 — Cleanup + Tests (depends on Group 4, parallel)

### Task 5.1: Delete deprecated files
**Deletes:** `src/lib/supabase/server.ts`, `src/lib/supabase/middleware.ts`, `src/lib/supabase/admin.ts`, `src/proxy.ts`
- Verify no remaining imports

### Task 5.2: Auth tests
**Modifies:** `src/lib/__tests__/auth.test.ts`
- Mock next-auth instead of Supabase

### Task 5.3: Final package.json cleanup
**Modifies:** `package.json`
- Verify @supabase/ssr removed
- pnpm install

## Key Implementation Notes

1. **Credentials provider + DB sessions**: Auth.js credentials provider doesn't auto-create DB sessions. In the `signIn` callback, manually insert a session row into the `sessions` table when the provider is "credentials":
```ts
callbacks: {
  async signIn({ user, account }) {
    if (account?.provider === "credentials") {
      const sessionToken = crypto.randomUUID()
      await db.insert(sessions).values({
        sessionToken,
        userId: user.id,
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })
      // Set session cookie manually
    }
    return true
  }
}
```
2. **Drizzle adapter table refs**: Pass table objects directly to adapter, not strings.
3. **User ID preservation**: Adapter uses existing users table — UUIDs preserved.
4. **getAuthContext signature unchanged**: 87 API route files need ZERO changes.
5. **Test auth bypass**: Middleware must preserve TEST_AUTH_BYPASS_ENABLED logic.
6. **Storage decoupling**: Use @supabase/supabase-js with service role key for storage only.
7. **All existing sessions invalidated**: Supabase JWT cookies won't be recognized by Auth.js. All users will be logged out on deploy — this is expected and acceptable.
8. **Middleware must allow `/api/*` through**: Current middleware lets all API routes pass unauthenticated (each route calls getAuthContext internally). New middleware must do the same — only protect page routes, not API routes.
9. **Onboarding route**: `/onboarding` must be in the middleware's allowed list for authenticated users (not redirected to /login).
10. **`src/db/queries/users.ts` uses createAdminClient**: Task 3.4 must rewrite the inviteUser function — confirmed it exists and imports from supabase admin.
11. **`src/app/api/onboarding/route.ts`**: Uses requireRole which calls getAuthContext — will work after Task 2.1 rewrite. No changes needed to this file.
