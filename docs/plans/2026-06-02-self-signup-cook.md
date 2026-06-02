# Self-Signup & Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable new clinics to self-register with an approval gate, and add an admin dashboard to manage pending signups.

**Architecture:** Add `status` column to tenants table. New `/signup` page creates tenant with `pending_approval` status. Middleware checks tenant status from JWT (surfaced through session callback) and redirects accordingly. Admin dashboard at `/admin/tenants` lets platform admins approve/reject. Existing onboarding wizard unchanged.

**Tech Stack:** Next.js 15, NextAuth v5 (JWT strategy), Drizzle ORM, Zod, bcryptjs, Resend

---

## Group A (parallel)

### Task 1: Database migration — add status column to tenants

**Files:**
- Create: `web/src/db/migrations/0020_tenant_status.sql`
- Modify: `web/src/db/schema.ts`

- [ ] **Step 1: Write migration SQL**

```sql
-- web/src/db/migrations/0020_tenant_status.sql
ALTER TABLE "floraclin"."tenants" ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'active';
```

- [ ] **Step 2: Update schema.ts — add status column to tenants table**

In `web/src/db/schema.ts`, add the `status` column to the `tenants` table definition, after the `slug` column:

```ts
status: varchar('status', { length: 20 }).notNull().default('active'),
```

- [ ] **Step 3: Run migration**

```bash
pnpm --filter @floraclin/web exec tsx src/db/run-migration.ts
```

- [ ] **Step 4: Verify column exists**

```bash
pnpm --filter @floraclin/web exec tsx -e "
import { db } from './src/db/client';
import { tenants } from './src/db/schema';
const rows = await db.select({ id: tenants.id, status: tenants.status }).from(tenants).limit(1);
console.log('Sample tenant:', rows[0]);
process.exit(0);
"
```

Expected: tenant row with `status: 'active'`

- [ ] **Step 5: Commit**

```bash
git add web/src/db/migrations/0020_tenant_status.sql web/src/db/schema.ts
git commit -m "feat(db): add status column to tenants table"
```

---

### Task 2: Signup validation schema

**Files:**
- Create: `web/src/validations/signup.ts`
- Create: `web/src/validations/__tests__/signup.test.ts`

- [ ] **Step 1: Write the test**

```ts
// web/src/validations/__tests__/signup.test.ts
import { describe, it, expect } from 'vitest'
import { signUpSchema, clinicDetailsSchema } from '../signup'

describe('signUpSchema', () => {
  const valid = {
    fullName: 'Maria Silva',
    email: 'maria@example.com',
    password: 'secure123',
    clinicName: 'Clínica Bela',
    phone: '11999998888',
  }

  it('accepts valid input', () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects missing fullName', () => {
    const result = signUpSchema.safeParse({ ...valid, fullName: '' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid email', () => {
    const result = signUpSchema.safeParse({ ...valid, email: 'not-email' })
    expect(result.success).toBe(false)
  })

  it('rejects short password', () => {
    const result = signUpSchema.safeParse({ ...valid, password: '1234567' })
    expect(result.success).toBe(false)
  })

  it('rejects missing clinicName', () => {
    const result = signUpSchema.safeParse({ ...valid, clinicName: '' })
    expect(result.success).toBe(false)
  })

  it('rejects missing phone', () => {
    const result = signUpSchema.safeParse({ ...valid, phone: '' })
    expect(result.success).toBe(false)
  })

  it('trims whitespace from fields', () => {
    const result = signUpSchema.safeParse({ ...valid, fullName: '  Maria Silva  ', clinicName: '  Clínica  ' })
    expect(result.success).toBe(true)
    expect(result.data!.fullName).toBe('Maria Silva')
    expect(result.data!.clinicName).toBe('Clínica')
  })
})

describe('clinicDetailsSchema', () => {
  it('accepts valid input', () => {
    const result = clinicDetailsSchema.safeParse({ clinicName: 'Clínica Bela', phone: '11999998888' })
    expect(result.success).toBe(true)
  })

  it('rejects empty clinicName', () => {
    const result = clinicDetailsSchema.safeParse({ clinicName: '', phone: '11999998888' })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @floraclin/web test:run src/validations/__tests__/signup.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Write the validation schemas**

```ts
// web/src/validations/signup.ts
import { z } from 'zod'

export const signUpSchema = z.object({
  fullName: z.string().trim().min(1, 'Nome é obrigatório').max(255),
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  password: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres'),
  clinicName: z.string().trim().min(1, 'Nome da clínica é obrigatório').max(255),
  phone: z.string().trim().min(10, 'Telefone inválido').max(20),
})

export const clinicDetailsSchema = z.object({
  clinicName: z.string().trim().min(1, 'Nome da clínica é obrigatório').max(255),
  phone: z.string().trim().min(10, 'Telefone inválido').max(20),
})

export type SignUpInput = z.infer<typeof signUpSchema>
export type ClinicDetailsInput = z.infer<typeof clinicDetailsSchema>
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @floraclin/web test:run src/validations/__tests__/signup.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/validations/signup.ts web/src/validations/__tests__/signup.test.ts
git commit -m "feat(validation): add signup and clinic details schemas"
```

---

### Task 3: Email templates for signup flow

**Files:**
- Modify: `web/src/lib/email.ts`

- [ ] **Step 1: Add three email functions to `web/src/lib/email.ts`**

Append after the existing `sendPasswordResetEmail` function:

```ts
export async function sendApprovalEmail(email: string, clinicName: string) {
  const safeName = escapeHtml(clinicName)
  const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/login`
  await getResend().emails.send({
    from: FROM,
    to: email,
    subject: 'Sua clínica foi aprovada — FloraClin',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #1C2B1E; margin-bottom: 24px;">FloraClin</h2>
        <p style="color: #2A2A2A; font-size: 16px; line-height: 1.5;">
          Sua clínica <strong>${safeName}</strong> foi aprovada!
        </p>
        <p style="color: #2A2A2A; font-size: 16px; line-height: 1.5;">
          Faça login para começar a configurar sua clínica.
        </p>
        <a href="${loginUrl}" style="display: inline-block; background: #4A6B52; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 24px 0;">
          Acessar FloraClin
        </a>
      </div>
    `,
  })
}

export async function sendRejectionEmail(email: string, clinicName: string) {
  const safeName = escapeHtml(clinicName)
  await getResend().emails.send({
    from: FROM,
    to: email,
    subject: 'Atualização sobre sua solicitação — FloraClin',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #1C2B1E; margin-bottom: 24px;">FloraClin</h2>
        <p style="color: #2A2A2A; font-size: 16px; line-height: 1.5;">
          Infelizmente não foi possível aprovar a clínica <strong>${safeName}</strong> neste momento.
        </p>
        <p style="color: #7A7A7A; font-size: 13px; margin-top: 32px;">
          Se tiver dúvidas, entre em contato pelo e-mail contato@floraclin.com.br.
        </p>
      </div>
    `,
  })
}

export async function sendNewSignupNotification(opts: {
  adminEmail: string
  clinicName: string
  ownerName: string
  ownerEmail: string
  phone: string
}) {
  const safeName = escapeHtml(opts.clinicName)
  const safeOwner = escapeHtml(opts.ownerName)
  const safeEmail = escapeHtml(opts.ownerEmail)
  const safePhone = escapeHtml(opts.phone)
  const adminUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/admin/tenants`
  await getResend().emails.send({
    from: FROM,
    to: opts.adminEmail,
    subject: `Nova clínica aguardando aprovação — ${safeName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #1C2B1E; margin-bottom: 24px;">FloraClin — Nova Solicitação</h2>
        <p style="color: #2A2A2A; font-size: 16px; line-height: 1.5;">
          <strong>${safeOwner}</strong> solicitou a criação da clínica <strong>${safeName}</strong>.
        </p>
        <p style="color: #2A2A2A; font-size: 14px; line-height: 1.5;">
          E-mail: ${safeEmail}<br/>
          Telefone: ${safePhone}
        </p>
        <a href="${adminUrl}" style="display: inline-block; background: #4A6B52; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 24px 0;">
          Revisar Solicitação
        </a>
      </div>
    `,
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/email.ts
git commit -m "feat(email): add approval, rejection, and new signup notification templates"
```

---

## Group B (parallel, depends on A)

### Task 4: Tenant self-signup and admin query functions

**Files:**
- Modify: `web/src/db/queries/admin-tenants.ts`

- [ ] **Step 1: Add self-signup tenant creation function with slug collision handling**

Add to `web/src/db/queries/admin-tenants.ts`, after the existing `createTenantWithOwner` function.

Note: The slug has a UNIQUE constraint. This function retries with a numeric suffix on collision.

```ts
export async function createSelfSignupTenant(data: {
  userId: string
  clinicName: string
  phone: string
}) {
  let baseSlug = data.clinicName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  if (!baseSlug) baseSlug = 'clinica'

  return withTransaction(async (tx) => {
    let slug = baseSlug
    let attempt = 0

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const [existing] = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .limit(1)

      if (!existing) break

      attempt++
      slug = `${baseSlug}-${attempt}`
    }

    const [tenant] = await tx
      .insert(tenants)
      .values({
        name: data.clinicName,
        slug,
        status: 'pending_approval',
        phone: data.phone,
      })
      .returning()

    await tx.insert(tenantUsers).values({
      tenantId: tenant.id,
      userId: data.userId,
      role: 'owner',
      isActive: true,
    })

    return tenant
  })
}
```

- [ ] **Step 2: Add admin query functions**

Append to the same file. Note: `approveTenant` guards against double-approval with a `status = 'pending_approval'` WHERE clause. `rejectTenant` sets both `status` and `deletedAt` for data integrity.

```ts
export async function listTenantsByStatus(status?: string) {
  const conditions = [isNull(tenants.deletedAt)]
  if (status) {
    conditions.push(eq(tenants.status, status))
  }

  return db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      phone: tenants.phone,
      email: tenants.email,
      createdAt: tenants.createdAt,
      ownerName: users.fullName,
      ownerEmail: users.email,
    })
    .from(tenants)
    .innerJoin(tenantUsers, and(eq(tenantUsers.tenantId, tenants.id), eq(tenantUsers.role, 'owner')))
    .innerJoin(users, eq(users.id, tenantUsers.userId))
    .where(and(...conditions))
    .orderBy(desc(tenants.createdAt))
    .groupBy(tenants.id, users.fullName, users.email)
}

export async function approveTenant(tenantId: string) {
  const [updated] = await db
    .update(tenants)
    .set({ status: 'active', updatedAt: new Date() })
    .where(and(eq(tenants.id, tenantId), eq(tenants.status, 'pending_approval')))
    .returning({ id: tenants.id, name: tenants.name })

  return updated
}

export async function rejectTenant(tenantId: string) {
  const [updated] = await db
    .update(tenants)
    .set({ status: 'rejected', deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tenants.id, tenantId), eq(tenants.status, 'pending_approval')))
    .returning({ id: tenants.id, name: tenants.name })

  return updated
}

export async function getTenantOwnerEmail(tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: users.email })
    .from(tenantUsers)
    .innerJoin(users, eq(users.id, tenantUsers.userId))
    .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.role, 'owner')))
    .limit(1)

  return row?.email ?? null
}
```

- [ ] **Step 3: Add missing imports at top of file**

Ensure these imports exist at the top of `web/src/db/queries/admin-tenants.ts`:

```ts
import { eq, and, isNull, desc } from 'drizzle-orm'
```

- [ ] **Step 4: Commit**

```bash
git add web/src/db/queries/admin-tenants.ts
git commit -m "feat(db): add self-signup tenant creation and admin query functions"
```

---

### Task 5: Auth config — add tenant info to JWT and session

**Files:**
- Modify: `web/src/lib/auth-config.ts`

**Critical note:** The middleware's `req.auth` contains the **Session** object, not the raw JWT token. Custom JWT fields must be explicitly surfaced through the `session` callback to be accessible in middleware.

- [ ] **Step 1: Update JWT callback to include tenant info**

In `web/src/lib/auth-config.ts`, replace the `jwt` callback:

```ts
async jwt({ token, user, trigger }) {
  if (user) {
    token.sub = user.id
  }

  if (user || trigger === 'update') {
    const userId = token.sub
    if (userId) {
      const [membership] = await db
        .select({
          tenantId: tenantUsers.tenantId,
          role: tenantUsers.role,
          tenantStatus: tenants.status,
          isPlatformAdmin: users.isPlatformAdmin,
        })
        .from(tenantUsers)
        .innerJoin(tenants, and(eq(tenants.id, tenantUsers.tenantId), isNull(tenants.deletedAt)))
        .innerJoin(users, eq(users.id, tenantUsers.userId))
        .where(
          and(
            eq(tenantUsers.userId, userId),
            eq(tenantUsers.isActive, true)
          )
        )
        .limit(1)

      if (!membership) {
        const [userRow] = await db
          .select({ isPlatformAdmin: users.isPlatformAdmin })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)

        token.tenantId = null
        token.tenantStatus = null
        token.role = null
        token.isPlatformAdmin = userRow?.isPlatformAdmin ?? false
      } else {
        token.tenantId = membership.tenantId
        token.tenantStatus = membership.tenantStatus
        token.role = membership.role
        token.isPlatformAdmin = membership.isPlatformAdmin
      }
    }
  }

  return token
},
```

- [ ] **Step 2: Update session callback to surface tenant fields**

Replace the `session` callback so middleware can access these fields via `req.auth`:

```ts
async session({ session, token }) {
  if (session.user && token.sub) {
    session.user.id = token.sub
  }
  ;(session as any).tenantId = token.tenantId ?? null
  ;(session as any).tenantStatus = token.tenantStatus ?? null
  ;(session as any).role = token.role ?? null
  ;(session as any).isPlatformAdmin = token.isPlatformAdmin ?? false
  return session
},
```

- [ ] **Step 3: Add imports at top of file**

Add to the existing imports in `web/src/lib/auth-config.ts`:

```ts
import { tenantUsers, tenants } from '@/db/schema'
import { and, isNull } from 'drizzle-orm'
```

Note: `db`, `users`, and `eq` are already imported.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/auth-config.ts
git commit -m "feat(auth): add tenant status and role to JWT token and session"
```

---

## Group C (parallel, depends on B)

### Task 6: Signup server actions

**Files:**
- Create: `web/src/actions/signup.ts`

Note: Signup actions go in a separate file from `auth.ts` to avoid loading bcrypt and DB modules on every auth action call.

- [ ] **Step 1: Create signup actions file**

```ts
// web/src/actions/signup.ts
'use server'

import { signIn } from '@/lib/auth-config'
import { redirect } from 'next/navigation'
import { AuthError } from 'next-auth'
import { signUpSchema, clinicDetailsSchema } from '@/validations/signup'
import { db } from '@/db/client'
import { users, tenantUsers } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { createSelfSignupTenant } from '@/db/queries/admin-tenants'
import { sendNewSignupNotification } from '@/lib/email'
import { withTransaction } from '@/lib/tenant'

export type SignUpState = {
  error?: { fullName?: string[]; email?: string[]; password?: string[]; clinicName?: string[]; phone?: string[]; general?: string[] }
} | null

export async function signUp(
  _prevState: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  const raw = {
    fullName: formData.get('fullName') as string,
    email: formData.get('email') as string,
    password: formData.get('password') as string,
    clinicName: formData.get('clinicName') as string,
    phone: formData.get('phone') as string,
  }

  const parsed = signUpSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors }
  }

  const { fullName, email, password, clinicName, phone } = parsed.data

  // Check email uniqueness
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  if (existing) {
    return { error: { email: ['Este e-mail já está cadastrado'] } }
  }

  // Create user + tenant atomically
  const userId = crypto.randomUUID()
  const passwordHash = await bcrypt.hash(password, 10)

  await withTransaction(async (tx) => {
    await tx.insert(users).values({ id: userId, fullName, email, passwordHash })
    // createSelfSignupTenant uses its own transaction, so we inline the tenant creation here
    let baseSlug = clinicName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    if (!baseSlug) baseSlug = 'clinica'

    // Check slug uniqueness within transaction
    let slug = baseSlug
    let attempt = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const [dup] = await tx.select({ id: (await import('@/db/schema')).tenants.id }).from((await import('@/db/schema')).tenants).where(eq((await import('@/db/schema')).tenants.slug, slug)).limit(1)
      if (!dup) break
      attempt++
      slug = `${baseSlug}-${attempt}`
    }

    const { tenants: tenantsTable } = await import('@/db/schema')
    const [tenant] = await tx.insert(tenantsTable).values({
      name: clinicName, slug, status: 'pending_approval', phone,
    }).returning()

    const { tenantUsers: tuTable } = await import('@/db/schema')
    await tx.insert(tuTable).values({ tenantId: tenant.id, userId, role: 'owner', isActive: true })
  })

  // Notify admin (fire-and-forget)
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL
  if (adminEmail) {
    sendNewSignupNotification({ adminEmail, clinicName, ownerName: fullName, ownerEmail: email, phone }).catch(() => {})
  }

  // Auto sign-in
  try {
    await signIn('credentials', { email, password, redirectTo: '/pending-approval' })
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: { general: ['Conta criada, mas erro ao fazer login automático. Faça login manualmente.'] } }
    }
    throw error
  }

  return null
}

export async function signUpWithGoogle() {
  await signIn('google', { redirectTo: '/signup/clinic-details' })
}

export type ClinicDetailsState = {
  error?: { clinicName?: string[]; phone?: string[]; general?: string[] }
} | null

export async function createClinicForOAuthUser(
  _prevState: ClinicDetailsState,
  formData: FormData,
): Promise<ClinicDetailsState> {
  const { auth: getSession } = await import('@/lib/auth-config')
  const session = await getSession()
  if (!session?.user?.id) {
    redirect('/login')
  }

  // Guard: check user doesn't already have a tenant
  const [existingMembership] = await db
    .select({ id: tenantUsers.id })
    .from(tenantUsers)
    .where(and(eq(tenantUsers.userId, session.user.id), eq(tenantUsers.isActive, true)))
    .limit(1)

  if (existingMembership) {
    redirect('/dashboard')
  }

  const raw = {
    clinicName: formData.get('clinicName') as string,
    phone: formData.get('phone') as string,
  }

  const parsed = clinicDetailsSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors }
  }

  const { clinicName, phone } = parsed.data

  await createSelfSignupTenant({ userId: session.user.id, clinicName, phone })

  // Notify admin
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL
  if (adminEmail) {
    sendNewSignupNotification({
      adminEmail,
      clinicName,
      ownerName: session.user.name ?? '',
      ownerEmail: session.user.email ?? '',
      phone,
    }).catch(() => {})
  }

  redirect('/pending-approval')
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/actions/signup.ts
git commit -m "feat(auth): add signup and clinic details server actions"
```

---

### Task 7: Admin API routes for approve/reject

**Files:**
- Create: `web/src/app/api/admin/tenants/[id]/approve/route.ts`
- Create: `web/src/app/api/admin/tenants/[id]/reject/route.ts`

- [ ] **Step 1: Create approve route**

```ts
// web/src/app/api/admin/tenants/[id]/approve/route.ts
import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { approveTenant, getTenantOwnerEmail } from '@/db/queries/admin-tenants'
import { sendApprovalEmail } from '@/lib/email'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformAdmin()
  const { id } = await params

  const tenant = await approveTenant(id)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found or not pending' }, { status: 404 })
  }

  const ownerEmail = await getTenantOwnerEmail(id)
  if (ownerEmail) {
    sendApprovalEmail(ownerEmail, tenant.name).catch(() => {})
  }

  return NextResponse.json({ data: tenant })
}
```

- [ ] **Step 2: Create reject route**

```ts
// web/src/app/api/admin/tenants/[id]/reject/route.ts
import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { rejectTenant, getTenantOwnerEmail } from '@/db/queries/admin-tenants'
import { sendRejectionEmail } from '@/lib/email'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformAdmin()
  const { id } = await params

  const ownerEmail = await getTenantOwnerEmail(id)
  const tenant = await rejectTenant(id)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found or not pending' }, { status: 404 })
  }

  if (ownerEmail) {
    sendRejectionEmail(ownerEmail, tenant.name).catch(() => {})
  }

  return NextResponse.json({ data: tenant })
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/admin/tenants/\[id\]/approve/route.ts web/src/app/api/admin/tenants/\[id\]/reject/route.ts
git commit -m "feat(api): add admin approve and reject tenant endpoints"
```

---

## Group D (parallel, depends on C)

### Task 8: Signup page

**Files:**
- Create: `web/src/app/(auth)/signup/page.tsx`

- [ ] **Step 1: Create the signup page**

```tsx
// web/src/app/(auth)/signup/page.tsx
'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { signUp, signUpWithGoogle, type SignUpState } from '@/actions/signup'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { maskPhone } from '@/lib/masks'

export default function SignUpPage() {
  const [state, formAction, isPending] = useActionState<SignUpState, FormData>(signUp, null)

  return (
    <div>
      <div className="flex items-center gap-2 mb-8 lg:hidden">
        <img src="/brand/logo-mint.svg" alt="" className="size-8" />
        <span className="font-display text-xl font-semibold text-charcoal">
          Flora<span className="text-sage">Clin</span>
        </span>
      </div>

      <h2 className="text-2xl font-semibold text-charcoal">Criar conta</h2>
      <p className="text-sm text-mid mt-1 mb-6">Cadastre sua clínica na FloraClin.</p>

      <form action={() => signUpWithGoogle()}>
        <Button type="submit" variant="outline" className="w-full gap-2">
          <svg className="size-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          Criar conta com Google
        </Button>
      </form>

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-[#E8ECEF]" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-cream px-3 text-mid">ou</span>
        </div>
      </div>

      {state?.error?.general && (
        <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error.general[0]}
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <div>
          <Label htmlFor="fullName">Nome completo</Label>
          <Input id="fullName" name="fullName" required autoComplete="name" />
          {state?.error?.fullName && <p className="text-xs text-red-600 mt-1">{state.error.fullName[0]}</p>}
        </div>

        <div>
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
          {state?.error?.email && <p className="text-xs text-red-600 mt-1">{state.error.email[0]}</p>}
        </div>

        <div>
          <Label htmlFor="password">Senha</Label>
          <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
          {state?.error?.password && <p className="text-xs text-red-600 mt-1">{state.error.password[0]}</p>}
        </div>

        <div>
          <Label htmlFor="clinicName">Nome da clínica</Label>
          <Input id="clinicName" name="clinicName" required />
          {state?.error?.clinicName && <p className="text-xs text-red-600 mt-1">{state.error.clinicName[0]}</p>}
        </div>

        <div>
          <Label htmlFor="phone">Telefone</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            required
            autoComplete="tel"
            onChange={(e) => { e.target.value = maskPhone(e.target.value) }}
          />
          {state?.error?.phone && <p className="text-xs text-red-600 mt-1">{state.error.phone[0]}</p>}
        </div>

        <Button type="submit" disabled={isPending} className="w-full bg-forest text-cream hover:bg-sage">
          {isPending ? 'Criando conta...' : 'Criar conta'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-mid">
        Já tem conta?{' '}
        <Link href="/login" className="font-medium text-forest hover:text-sage">
          Fazer login
        </Link>
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/\(auth\)/signup/page.tsx
git commit -m "feat(auth): add self-signup page"
```

---

### Task 9: Clinic details page (Google OAuth post-signup)

**Files:**
- Create: `web/src/app/(auth)/signup/clinic-details/page.tsx`

- [ ] **Step 1: Create clinic details page**

```tsx
// web/src/app/(auth)/signup/clinic-details/page.tsx
'use client'

import { useActionState } from 'react'
import { createClinicForOAuthUser, type ClinicDetailsState } from '@/actions/signup'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { maskPhone } from '@/lib/masks'

export default function ClinicDetailsPage() {
  const [state, formAction, isPending] = useActionState<ClinicDetailsState, FormData>(createClinicForOAuthUser, null)

  return (
    <div>
      <div className="flex items-center gap-2 mb-8 lg:hidden">
        <img src="/brand/logo-mint.svg" alt="" className="size-8" />
        <span className="font-display text-xl font-semibold text-charcoal">
          Flora<span className="text-sage">Clin</span>
        </span>
      </div>

      <h2 className="text-2xl font-semibold text-charcoal">Dados da clínica</h2>
      <p className="text-sm text-mid mt-1 mb-6">Preencha os dados da sua clínica para continuar.</p>

      {state?.error?.general && (
        <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error.general[0]}
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <div>
          <Label htmlFor="clinicName">Nome da clínica</Label>
          <Input id="clinicName" name="clinicName" required />
          {state?.error?.clinicName && <p className="text-xs text-red-600 mt-1">{state.error.clinicName[0]}</p>}
        </div>

        <div>
          <Label htmlFor="phone">Telefone</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            required
            autoComplete="tel"
            onChange={(e) => { e.target.value = maskPhone(e.target.value) }}
          />
          {state?.error?.phone && <p className="text-xs text-red-600 mt-1">{state.error.phone[0]}</p>}
        </div>

        <Button type="submit" disabled={isPending} className="w-full bg-forest text-cream hover:bg-sage">
          {isPending ? 'Criando clínica...' : 'Continuar'}
        </Button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/\(auth\)/signup/clinic-details/page.tsx
git commit -m "feat(auth): add clinic details page for Google OAuth signup"
```

---

### Task 10: Pending approval page

**Files:**
- Create: `web/src/app/pending-approval/layout.tsx`
- Create: `web/src/app/pending-approval/page.tsx`
- Create: `web/src/app/pending-approval/logout-button.tsx`

- [ ] **Step 1: Create the layout (minimal, no sidebar)**

```tsx
// web/src/app/pending-approval/layout.tsx
export default function PendingApprovalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-cream px-6">
      <div className="w-full max-w-md text-center">
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the page**

Note: This page directly queries the DB for fresh tenant status (not the JWT), so if the admin just approved, a page refresh will detect it and redirect to dashboard.

```tsx
// web/src/app/pending-approval/page.tsx
import { auth } from '@/lib/auth-config'
import { redirect } from 'next/navigation'
import { db } from '@/db/client'
import { tenantUsers, tenants } from '@/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { LogoutButton } from './logout-button'

export default async function PendingApprovalPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const [membership] = await db
    .select({ tenantName: tenants.name, status: tenants.status })
    .from(tenantUsers)
    .innerJoin(tenants, and(eq(tenants.id, tenantUsers.tenantId), isNull(tenants.deletedAt)))
    .where(and(eq(tenantUsers.userId, session.user.id), eq(tenantUsers.isActive, true)))
    .limit(1)

  if (!membership) redirect('/signup')
  if (membership.status === 'active') redirect('/dashboard')

  return (
    <>
      <img src="/brand/logo-mint.svg" alt="" className="size-16 mx-auto mb-6" />
      <h1 className="font-display text-3xl font-semibold text-charcoal">
        Flora<span className="text-sage">Clin</span>
      </h1>
      <p className="mt-2 text-lg font-medium text-charcoal">{membership.tenantName}</p>
      <div className="mt-8 rounded-lg bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <p className="text-sm text-mid leading-relaxed">
          Sua clínica está sendo analisada. Notificaremos por e-mail quando estiver tudo pronto.
        </p>
      </div>
      <LogoutButton />
    </>
  )
}
```

- [ ] **Step 3: Create the logout button (client component)**

```tsx
// web/src/app/pending-approval/logout-button.tsx
'use client'

import { logout } from '@/actions/auth'
import { Button } from '@/components/ui/button'

export function LogoutButton() {
  return (
    <form action={logout} className="mt-6">
      <Button type="submit" variant="outline" className="text-mid">
        Sair
      </Button>
    </form>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add web/src/app/pending-approval/
git commit -m "feat(auth): add pending approval page"
```

---

### Task 11: Admin dashboard page

**Files:**
- Create: `web/src/app/admin/layout.tsx`
- Create: `web/src/app/admin/tenants/page.tsx`
- Create: `web/src/app/admin/tenants/admin-tenants-client.tsx`

- [ ] **Step 1: Create admin layout**

```tsx
// web/src/app/admin/layout.tsx
import { requirePlatformAdmin } from '@/lib/auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin()

  return (
    <div className="min-h-screen bg-cream">
      <header className="border-b border-[#E8ECEF] bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <img src="/brand/logo-mint.svg" alt="" className="size-8" />
          <span className="font-display text-xl font-semibold text-charcoal">
            Flora<span className="text-sage">Clin</span>
          </span>
          <span className="text-xs font-medium text-mid uppercase tracking-wider ml-2 px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full">
            Admin
          </span>
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  )
}
```

- [ ] **Step 2: Create admin tenants server page**

```tsx
// web/src/app/admin/tenants/page.tsx
import { listTenantsByStatus } from '@/db/queries/admin-tenants'
import { AdminTenantsClient } from './admin-tenants-client'

export default async function AdminTenantsPage() {
  const allTenants = await listTenantsByStatus()
  return <AdminTenantsClient initialTenants={allTenants} />
}
```

- [ ] **Step 3: Create client component**

```tsx
// web/src/app/admin/tenants/admin-tenants-client.tsx
'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

interface TenantRow {
  id: string
  name: string
  slug: string
  status: string
  phone: string | null
  email: string | null
  createdAt: Date
  ownerName: string
  ownerEmail: string
}

const STATUS_BADGE: Record<string, string> = {
  pending_approval: 'bg-amber-50 text-amber-700',
  active: 'bg-emerald-50 text-emerald-700',
  suspended: 'bg-red-50 text-red-700',
}

const STATUS_LABEL: Record<string, string> = {
  pending_approval: 'Pendente',
  active: 'Ativa',
  suspended: 'Suspensa',
}

interface AdminTenantsClientProps {
  initialTenants: TenantRow[]
}

export function AdminTenantsClient({ initialTenants }: AdminTenantsClientProps) {
  const [tenants, setTenants] = useState(initialTenants)
  const [filter, setFilter] = useState<'all' | 'pending_approval'>('pending_approval')
  const [loading, setLoading] = useState<string | null>(null)

  const filtered = filter === 'all' ? tenants : tenants.filter((t) => t.status === filter)

  async function handleApprove(id: string) {
    setLoading(id)
    try {
      const res = await fetch(`/api/admin/tenants/${id}/approve`, { method: 'POST' })
      if (!res.ok) throw new Error('Erro ao aprovar')
      setTenants((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'active' } : t)))
      toast.success('Clínica aprovada')
    } catch {
      toast.error('Erro ao aprovar clínica')
    } finally {
      setLoading(null)
    }
  }

  async function handleReject(id: string) {
    setLoading(id)
    try {
      const res = await fetch(`/api/admin/tenants/${id}/reject`, { method: 'POST' })
      if (!res.ok) throw new Error('Erro ao rejeitar')
      setTenants((prev) => prev.filter((t) => t.id !== id))
      toast.success('Clínica rejeitada')
    } catch {
      toast.error('Erro ao rejeitar clínica')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-charcoal mb-1">Clínicas</h1>
      <p className="text-sm text-mid mb-6">Gerencie solicitações de novas clínicas.</p>

      <div className="flex gap-2 mb-4">
        <Button
          variant={filter === 'pending_approval' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('pending_approval')}
        >
          Pendentes ({tenants.filter((t) => t.status === 'pending_approval').length})
        </Button>
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('all')}
        >
          Todas ({tenants.length})
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg bg-white p-8 text-center shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <p className="text-sm text-mid">
            {filter === 'pending_approval' ? 'Nenhuma clínica pendente.' : 'Nenhuma clínica encontrada.'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E8ECEF] text-left text-xs font-medium text-mid uppercase tracking-wider">
                <th className="px-4 py-3">Clínica</th>
                <th className="px-4 py-3">Proprietário</th>
                <th className="px-4 py-3">Contato</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Cadastro</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((tenant) => (
                <tr key={tenant.id} className="border-b border-[#F0F0F0] last:border-0">
                  <td className="px-4 py-3 font-medium text-charcoal">{tenant.name}</td>
                  <td className="px-4 py-3 text-mid">{tenant.ownerName}</td>
                  <td className="px-4 py-3 text-mid">
                    <div>{tenant.ownerEmail}</div>
                    {tenant.phone && <div className="text-xs">{tenant.phone}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={STATUS_BADGE[tenant.status] ?? 'bg-slate-100 text-slate-600'}>
                      {STATUS_LABEL[tenant.status] ?? tenant.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-mid text-xs">
                    {formatDistanceToNow(new Date(tenant.createdAt), { locale: ptBR, addSuffix: true })}
                  </td>
                  <td className="px-4 py-3">
                    {tenant.status === 'pending_approval' && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={loading === tenant.id}
                          onClick={() => handleApprove(tenant.id)}
                        >
                          Aprovar
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={loading === tenant.id}
                          onClick={() => handleReject(tenant.id)}
                        >
                          Rejeitar
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add web/src/app/admin/
git commit -m "feat(admin): add tenant management dashboard"
```

---

### Task 12: Login page — add signup link

**Files:**
- Modify: `web/src/app/(auth)/login/page.tsx`

- [ ] **Step 1: Add signup link at the bottom of the login page**

After the existing form content, before the closing `</div>`, add:

```tsx
<p className="mt-6 text-center text-sm text-mid">
  Não tem conta?{' '}
  <Link href="/signup" className="font-medium text-forest hover:text-sage">
    Criar conta
  </Link>
</p>
```

Add `Link` to the imports if not already present:

```ts
import Link from 'next/link'
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/\(auth\)/login/page.tsx
git commit -m "feat(auth): add signup link to login page"
```

---

## Group E (depends on D)

### Task 13: Middleware — tenant status checks and signup route access

**Files:**
- Modify: `web/src/middleware.ts`

- [ ] **Step 1: Update middleware to handle signup routes and tenant status**

Replace the full middleware logic in `web/src/middleware.ts`. Key points:
- Reads tenant status from `req.auth` (session object, populated via session callback)
- Platform admins bypass tenant check (can reach `/admin/*` even without a personal tenant)
- `/signup/clinic-details` requires auth but no tenant

```ts
import { auth } from '@/lib/auth-config'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isAuthenticated = !!req.auth

  // Test auth bypass
  if (
    process.env.TEST_AUTH_BYPASS_ENABLED === 'true' &&
    process.env.NODE_ENV !== 'production'
  ) {
    const testUserId = req.headers.get('x-test-user-id')
    if (testUserId) return NextResponse.next()
  }

  // Public routes — always allow
  if (
    pathname.startsWith('/c/') ||
    pathname.startsWith('/a/') ||
    pathname.startsWith('/sign/') ||
    pathname.startsWith('/verify/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|webp)$/)
  ) {
    return NextResponse.next()
  }

  // Auth pages — redirect authenticated users appropriately
  if (pathname === '/login' || pathname === '/reset-password' || pathname === '/signup') {
    if (isAuthenticated) {
      const session = req.auth as any
      const tenantStatus = session?.tenantStatus as string | null
      const tenantId = session?.tenantId as string | null

      if (!tenantId) return NextResponse.redirect(new URL('/signup/clinic-details', req.url))
      if (tenantStatus === 'pending_approval') return NextResponse.redirect(new URL('/pending-approval', req.url))
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
    return NextResponse.next()
  }

  // Not authenticated — redirect to login
  if (!isAuthenticated) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // Authenticated from here — read tenant info from session
  const session = req.auth as any
  const tenantStatus = session?.tenantStatus as string | null
  const tenantId = session?.tenantId as string | null
  const isPlatformAdmin = session?.isPlatformAdmin as boolean

  // Platform admins can always access /admin routes regardless of tenant status
  if (pathname.startsWith('/admin')) {
    if (isPlatformAdmin) return NextResponse.next()
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  // No tenant membership — Google OAuth user who hasn't set up clinic
  if (!tenantId && !isPlatformAdmin) {
    if (pathname === '/signup/clinic-details') return NextResponse.next()
    return NextResponse.redirect(new URL('/signup/clinic-details', req.url))
  }

  // Pending approval — only allow pending-approval page
  if (tenantStatus === 'pending_approval') {
    if (pathname === '/pending-approval') return NextResponse.next()
    return NextResponse.redirect(new URL('/pending-approval', req.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|face-templates|logo.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/middleware.ts
git commit -m "feat(auth): add tenant status checks and signup route handling in middleware"
```

---

## Group F (depends on E)

### Task 14: Tests

**Files:**
- Create: `web/src/validations/__tests__/signup.test.ts` (already done in Task 2)
- Create: `web/src/actions/__tests__/signup.test.ts`

- [ ] **Step 1: Write integration tests for signup action**

```ts
// web/src/actions/__tests__/signup.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth-config', () => ({
  signIn: vi.fn(),
  auth: vi.fn(),
}))

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => []),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => [{ id: 'tenant-1', name: 'Test Clinic' }]),
      })),
    })),
    transaction: vi.fn((fn: any) => fn({
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() => [{ id: 'tenant-1', name: 'Test Clinic', slug: 'test-clinic' }]),
        })),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => []),
          })),
        })),
      })),
    })),
  },
}))

vi.mock('@/lib/tenant', () => ({
  withTransaction: vi.fn((fn: any) => fn({
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => [{ id: 'tenant-1', name: 'Test Clinic', slug: 'test-clinic' }]),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => []),
        })),
      })),
    })),
  })),
}))

vi.mock('@/db/queries/admin-tenants', () => ({
  createSelfSignupTenant: vi.fn(() => ({ id: 'tenant-1', name: 'Test Clinic' })),
}))

vi.mock('@/lib/email', () => ({
  sendNewSignupNotification: vi.fn(),
}))

describe('signUp action', () => {
  it('rejects empty form data', async () => {
    const { signUp } = await import('../signup')
    const formData = new FormData()
    const result = await signUp(null, formData)
    expect(result?.error).toBeDefined()
  })

  it('rejects invalid email', async () => {
    const { signUp } = await import('../signup')
    const formData = new FormData()
    formData.set('fullName', 'Maria')
    formData.set('email', 'not-email')
    formData.set('password', 'secure123')
    formData.set('clinicName', 'Test')
    formData.set('phone', '11999998888')
    const result = await signUp(null, formData)
    expect(result?.error?.email).toBeDefined()
  })

  it('rejects short password', async () => {
    const { signUp } = await import('../signup')
    const formData = new FormData()
    formData.set('fullName', 'Maria')
    formData.set('email', 'maria@test.com')
    formData.set('password', '1234567')
    formData.set('clinicName', 'Test')
    formData.set('phone', '11999998888')
    const result = await signUp(null, formData)
    expect(result?.error?.password).toBeDefined()
  })
})
```

- [ ] **Step 2: Run tests**

```bash
pnpm --filter @floraclin/web test:run src/actions/__tests__/signup.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add web/src/actions/__tests__/signup.test.ts
git commit -m "test(auth): add signup action tests"
```
