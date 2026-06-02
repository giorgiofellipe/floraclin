# Self-Signup & Onboarding Review

## Goal

Enable new clinics to sign up on their own (no admin intervention to create accounts), with an approval gate before they can use the platform. Review the existing onboarding wizard to confirm it still covers the minimum viable setup after recent feature additions.

## Scope

Two pieces:

1. **Self-signup flow** — public signup page, tenant creation with `pending_approval` status, approval queue, admin dashboard
2. **Onboarding review** — confirm the existing 4-step wizard (clinic info → procedures → products → team invites) is sufficient; no new steps needed

Out of scope: WhatsApp setup in onboarding (too complex for a wizard step), financial settings, calendar sync, document templates, packages — all discoverable in settings post-onboarding.

---

## Database Changes

### Tenant status column

Add a `status` column to the `tenants` table:

```
status: varchar('status', { length: 20 }).notNull().default('active')
```

Valid values: `'pending_approval'` | `'active'` | `'suspended'`

- Default is `'active'` so existing tenants and admin-created tenants are unaffected.
- Self-signup sets it to `'pending_approval'` explicitly.
- `'suspended'` reserved for future use (e.g., non-payment).

**Migration**: Add column with default `'active'`. All existing rows get `'active'` automatically.

---

## Signup Flow

### New page: `/signup`

Two registration paths, both landing on the same outcome (user + tenant + membership created):

#### Email + password path

Form fields:
- Full name (required, max 255 chars)
- Email (required, valid email, unique across users)
- Password (required, min 8 chars)
- Clinic name (required, max 255 chars)
- Phone (required, max 20 chars, Brazilian phone mask)

On submit:
1. Validate all fields (Zod schema)
2. Check email uniqueness
3. In a single DB transaction:
   - Create user (hash password with bcrypt)
   - Generate slug from clinic name (same logic as `createTenantWithOwner`)
   - Create tenant with `status: 'pending_approval'`
   - Create `tenantUsers` entry with `role: 'owner'`, `isActive: true`
4. Auto-sign in via NextAuth credentials
5. Redirect to `/pending-approval`

#### Google OAuth path

1. User clicks "Criar conta com Google" on `/signup`
2. Google OAuth completes → NextAuth creates/finds user
3. Detect that user has no tenant membership → redirect to `/signup/clinic-details`
4. `/signup/clinic-details` page: short form with clinic name + phone (name/email pre-filled from Google profile, read-only)
5. On submit: create tenant + membership (same transaction logic as above, minus user creation)
6. Redirect to `/pending-approval`

### Validation schema

```ts
const signUpSchema = z.object({
  fullName: z.string().min(1).max(255),
  email: z.string().email(),
  password: z.string().min(8),
  clinicName: z.string().min(1).max(255),
  phone: z.string().min(10).max(20),
})

const clinicDetailsSchema = z.object({
  clinicName: z.string().min(1).max(255),
  phone: z.string().min(10).max(20),
})
```

### Server action: `signUp`

Location: `web/src/actions/auth.ts`

- Validates input against `signUpSchema`
- Checks `users` table for existing email → returns error if exists
- Wraps user + tenant + membership creation in `db.transaction()`
- Calls `signIn('credentials', ...)` to auto-login
- Returns redirect to `/pending-approval`

### Server action: `createClinicForOAuthUser`

Location: `web/src/actions/auth.ts`

- For Google OAuth users who authenticated but have no tenant
- Validates `clinicDetailsSchema`
- Creates tenant + membership in transaction (user already exists)
- Redirects to `/pending-approval`

---

## Pending Approval State

### New page: `/pending-approval`

Branded page (uses the app layout, no sidebar):
- FloraClin logo
- Clinic name (from tenant)
- Message: "Sua clínica está sendo analisada. Notificaremos por e-mail quando estiver tudo pronto."
- "Sair" button (logout)

No interactivity beyond logout. Clean, reassuring design.

### Middleware changes

Update `web/src/middleware.ts`:

After the existing auth check, add tenant status resolution:

1. Get user's tenant membership (lightweight query or JWT claim)
2. If user has no tenant → redirect to `/signup/clinic-details` (Google OAuth user who hasn't completed signup)
3. If `tenant.status === 'pending_approval'` → redirect to `/pending-approval`
4. If `tenant.status === 'suspended'` → redirect to a `/suspended` page (future, just redirect to `/pending-approval` for now)

**Exempt routes** (no tenant status check): `/pending-approval`, `/signup/*`, `/api/auth/*`, `/login`, `/reset-password`, all existing public routes (`/c/`, `/a/`, `/sign/`, `/verify/`).

### JWT optimization

To avoid a DB query on every request in middleware, add `tenantStatus` and `tenantId` to the JWT token in the NextAuth `jwt` callback. Update the token when:
- User signs in (initial token creation)
- Session is refreshed (check DB, update if changed)

This means after admin approves a tenant, the user needs to re-login (or we force a session refresh) for the status change to take effect. The approval email will say "You can now log in."

---

## Admin Dashboard

### New page: `/admin/tenants`

Protected by a superadmin check — hardcoded email list in an environment variable (`ADMIN_EMAILS`). Not part of the normal tenant/role system.

#### Layout

Simple table with columns:
- Clinic name
- Owner name
- Email
- Phone
- Signup date (relative, e.g., "há 2 horas")
- Status badge (`pending_approval` / `active` / `suspended`)
- Actions: Approve / Reject buttons (only for `pending_approval`)

#### Tabs or filter

Two views:
- **Pendentes** (default): `status = 'pending_approval'`, sorted by newest first
- **Todas**: all tenants, sorted by creation date

#### API routes

**POST `/api/admin/tenants/[id]/approve`**:
1. Verify superadmin
2. Set `tenant.status = 'active'`
3. Send approval email via Resend to the owner: "Sua clínica foi aprovada! Faça login para começar a configurar."
4. Return success

**POST `/api/admin/tenants/[id]/reject`**:
1. Verify superadmin
2. Set `tenant.deletedAt = now()` (soft delete)
3. Send rejection email via Resend: "Infelizmente não foi possível aprovar sua clínica no momento."
4. Return success

#### Superadmin guard

```ts
function isSuperAdmin(email: string): boolean {
  const adminEmails = process.env.ADMIN_EMAILS?.split(',') ?? []
  return adminEmails.includes(email)
}
```

Middleware for `/admin/*` routes checks this. Non-superadmins get 403.

---

## Login Page Changes

### Add signup link

Below the existing login form, add a text link:

```
Não tem conta? Criar conta
```

"Criar conta" links to `/signup`. Minimal change — just a line of text + link.

### Handle tenantless Google OAuth users

When a Google OAuth user logs in but has no tenant membership, redirect to `/signup/clinic-details` instead of `/dashboard`. This is handled in middleware (see Middleware changes above).

---

## Onboarding — No Changes

The existing 4-step wizard already covers the lean onboarding needs:

1. **Clinic info**: name, phone, email, address, working hours, slug
2. **Procedure types**: pre-selected defaults with customization
3. **Products**: pre-selected by category
4. **Team invites**: optional, can skip

On completion, it seeds: evaluation templates, consent templates (general + procedure-specific + service contract).

After reviewing recent feature additions (WhatsApp, financial, calendar, packages, documents, compliance signatures), none require onboarding steps — they're all configurable in settings and don't block a clinic from starting basic operations.

---

## Email Templates

Two new transactional emails via Resend:

### Approval email
- Subject: "Sua clínica foi aprovada - FloraClin"
- Body: Clinic name, brief congratulations, CTA button "Acessar FloraClin" linking to `/login`

### Rejection email
- Subject: "Atualização sobre sua solicitação - FloraClin"
- Body: Clinic name, polite message that the request wasn't approved, contact email for questions

### New signup notification (to admin)
- Subject: "Nova clínica aguardando aprovação - {clinicName}"
- Body: Clinic name, owner name, email, phone, link to `/admin/tenants`

---

## Security Considerations

- **Rate limiting**: Apply rate limiting on the signup endpoint to prevent abuse (same pattern as login)
- **Email verification**: Not required at signup (Google OAuth already verifies; email+password users will interact via the approval email). Can be added later if spam becomes an issue.
- **Password hashing**: bcrypt with default rounds (already used in the codebase for credential auth)
- **CSRF**: NextAuth handles this for the auth flow; server actions have built-in CSRF protection
- **Slug collision**: The slug generation logic already handles uniqueness (appends a number if slug exists)

---

## Testing

- Unit tests for `signUpSchema` and `clinicDetailsSchema` validation
- Unit test for `signUp` server action (happy path + duplicate email)
- Unit test for `createClinicForOAuthUser` action
- Unit test for approve/reject API routes
- Unit test for `isSuperAdmin` guard
- Integration test: full signup → pending → approve → onboarding flow (if E2E infra exists)
