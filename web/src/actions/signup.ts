'use server'

import { signIn } from '@/lib/auth-config'
import { redirect } from 'next/navigation'
import { AuthError } from 'next-auth'
import { signUpSchema, clinicDetailsSchema } from '@/validations/signup'
import { db } from '@/db/client'
import { users, tenants, tenantUsers } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { createSelfSignupTenant, generateSlug } from '@/db/queries/admin-tenants'
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

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  if (existing) {
    return { error: { email: ['Este e-mail já está cadastrado'] } }
  }

  const userId = crypto.randomUUID()
  const passwordHash = await bcrypt.hash(password, 10)

  try {
    await withTransaction(async (tx) => {
      await tx.insert(users).values({ id: userId, fullName, email, passwordHash })

      const baseSlug = generateSlug(clinicName)
      let slug = baseSlug
      let attempt = 0
      for (;;) {
        const [dup] = await tx
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.slug, slug))
          .limit(1)
        if (!dup) break
        attempt++
        slug = `${baseSlug}-${attempt}`
      }

      const [tenant] = await tx
        .insert(tenants)
        .values({ name: clinicName, slug, status: 'pending_approval', phone })
        .returning()

      await tx.insert(tenantUsers).values({
        tenantId: tenant.id,
        userId,
        role: 'owner',
        isActive: true,
      })
    })
  } catch (err) {
    if (err instanceof Error && err.message.includes('unique')) {
      return { error: { email: ['Este e-mail já está cadastrado'] } }
    }
    throw err
  }

  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL
  if (adminEmail) {
    sendNewSignupNotification({ adminEmail, clinicName, ownerName: fullName, ownerEmail: email, phone }).catch(() => {})
  }

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
  const { auth } = await import('@/lib/auth-config')
  const session = await auth()
  if (!session?.user?.id) {
    redirect('/login')
  }

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
