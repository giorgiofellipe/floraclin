'use server'

import { signIn } from '@/lib/auth-config'
import { redirect } from 'next/navigation'
import { signUpSchema, clinicDetailsSchema } from '@/validations/signup'
import { db } from '@/db/client'
import { users, tenants, tenantUsers, plans } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { createSelfSignupTenant, generateSlug } from '@/db/queries/admin-tenants'
import { createSubscription } from '@/db/queries/subscriptions'
import { sendNewSignupNotification, sendConfirmationEmail } from '@/lib/email'
import { withTransaction } from '@/lib/tenant'
import { notifyDiscord } from '@/lib/discord'
import { issueConfirmationToken } from '@/lib/confirm-email'
import { getAppUrl } from '@/lib/app-url'
import { isUniqueViolation } from '@/lib/errors'

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

  let tenantId: string | undefined
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
        .values({ name: clinicName, slug, status: 'active', phone })
        .returning()

      tenantId = tenant.id

      await tx.insert(tenantUsers).values({
        tenantId: tenant.id,
        userId,
        role: 'owner',
        isActive: true,
      })
    })
  } catch (err) {
    // The SELECT above answers the ordinary case; this answers the race it
    // cannot. Two concurrent signups for one address both read no row, and
    // uq_users_email_lower is what stops both from inserting. Matched on the
    // index name so a unique violation somewhere else in the transaction
    // still surfaces as itself.
    if (isUniqueViolation(err, 'uq_users_email_lower')) {
      return { error: { email: ['Este e-mail já está cadastrado'] } }
    }
    throw err
  }

  if (tenantId) {
    await notifyDiscord({ kind: 'clinic.created', tenantName: clinicName, city: null, state: null, tenantId })

    const [freePlan] = await db.select().from(plans).where(eq(plans.slug, 'free')).limit(1)
    if (freePlan) {
      const { created } = await createSubscription(tenantId, freePlan.id)
      if (created) {
        await notifyDiscord({
          kind: 'subscription.created',
          tenantName: clinicName,
          planName: freePlan.name,
          priceCents: freePlan.priceCents,
          tenantId,
        })
      }
    }
  }

  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL
  if (adminEmail) {
    sendNewSignupNotification({ adminEmail, clinicName, ownerName: fullName, ownerEmail: email, phone }).catch(() => {})
  }

  // The tenant, user and membership rows are already committed above. If
  // Resend throws here and the error escapes, the sign-in below never runs:
  // the account exists, cannot be registered again because the email is
  // taken, and has no session to reach /confirm-email for a resend. Sending
  // must never be allowed to block sign-in.
  try {
    const appUrl = getAppUrl()
    const rawToken = await issueConfirmationToken(email)
    const confirmUrl = `${appUrl}/api/auth/confirm?email=${encodeURIComponent(email)}&token=${rawToken}`
    await sendConfirmationEmail(email, confirmUrl, clinicName)
  } catch (err) {
    console.error('Failed to send confirmation email', err)
  }

  // Deliberately no signIn here. Signing the user in before they confirm
  // would hand an unconfirmed account a working session cookie, and the API
  // would accept it: middleware's /api branch returns before any email check.
  // The first sign-in happens after confirming, and `authorize` refuses until
  // then. The address rides in the query string because there is no session
  // for the page to read it from.
  redirect(`/confirm-email?email=${encodeURIComponent(email)}`)
}

export async function signUpWithGoogle() {
  await signIn('google', { redirectTo: '/signup/clinic-details' })
}

export type ClinicDetailsState = {
  error?: { clinicName?: string[]; phone?: string[]; general?: string[] }
  success?: boolean
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
    // Same reason as the success path below: a redirect here would hand
    // /dashboard a token that still says tenantId: null and get bounced
    // straight back. This is the retry case, so the clinic already exists and
    // there is nothing left to do but refresh the token.
    return { success: true }
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

  const tenant = await createSelfSignupTenant({ userId: session.user.id, clinicName, phone })

  await notifyDiscord({ kind: 'clinic.created', tenantName: clinicName, city: null, state: null, tenantId: tenant.id })

  const [freePlan] = await db.select().from(plans).where(eq(plans.slug, 'free')).limit(1)
  if (freePlan) {
    const { created } = await createSubscription(tenant.id, freePlan.id)
    if (created) {
      await notifyDiscord({
        kind: 'subscription.created',
        tenantName: clinicName,
        planName: freePlan.name,
        priceCents: freePlan.priceCents,
        tenantId: tenant.id,
      })
    }
  }

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

  // Deliberately no redirect. The JWT was minted at Google sign-in, before
  // this membership existed, so it still carries tenantId: null. Middleware
  // sends any authenticated user without a tenant back to this very page, so
  // redirecting to /dashboard here loops: the client has to refresh the
  // session first. It reports success and navigates once the token is
  // current.
  return { success: true }
}
