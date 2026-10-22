'use server'

import { signIn, signOut } from '@/lib/auth-config'
import { redirect } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import { after } from 'next/server'
import { signUpSchema, clinicDetailsSchema } from '@/validations/signup'
import { db } from '@/db/client'
import { users, tenants, tenantUsers, plans } from '@/db/schema'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { createSelfSignupTenant, findAvailableSlug, generateSlug, insertSelfSignupTenantBase } from '@/db/queries/admin-tenants'
import { createSubscription } from '@/db/queries/subscriptions'
import { getClinicMemberships } from '@/db/queries/clinic-membership'
import { TENANT_COOKIE, TENANT_COOKIE_OPTIONS } from '@/lib/tenant-cookie'
import { SUSPENDED_CLINIC_MESSAGE } from '@/lib/clinic-suspended'
import { sendConfirmationEmail } from '@/lib/email'
import { withTransaction } from '@/lib/tenant'
import { notifySignupStarted } from '@/lib/signup-notifications'
import { issueConfirmationToken } from '@/lib/confirm-email'
import { getAppUrl } from '@/lib/app-url'
import { isUndefinedColumn, isUniqueViolation } from '@/lib/errors'
import { buildFbc, generateMetaEventId } from '@/lib/marketing-attribution'
import { FIRST_TOUCH_COOKIE, parseFirstTouch, withoutClickIds, type FirstTouch } from '@/lib/first-touch'
import { scheduleLifecycleWelcome } from '@/lib/lifecycle-sender'
import { isPlatformAdminSession, placeholderClinicName } from '@/lib/clinic-placeholder'
import { reportSideEffectFailure } from '@/lib/observability'
import { sendSignupCompleteRegistrationEvent, type SendSignupCompleteRegistrationInput } from '@/lib/meta/events'
import {
  CONFIRM_EMAIL_STATE_COOKIE,
  confirmEmailStateCookieOptions,
  serializeConfirmEmailPageState,
} from '@/lib/confirm-email-page-state'

export type SignUpState = {
  error?: { fullName?: string[]; email?: string[]; password?: string[]; clinicName?: string[]; phone?: string[]; general?: string[] }
} | null

export async function signUp(
  _prevState: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  const requestHeaders = await headers()
  const cookieStore = await cookies()
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
  const marketingConsent = formData.get('marketingConsent') === 'granted'
  const metaEventId = marketingConsent
    ? String(formData.get('metaEventId') || generateMetaEventId('complete_registration'))
    : null
  const firstTouch = parseFirstTouch(cookieStore.get(FIRST_TOUCH_COOKIE)?.value)
  const tenantAttribution = attributionForTenant(firstTouch, metaEventId)
  const appUrl = getAppUrl()

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

      const slug = await findAvailableSlug(tx, generateSlug(clinicName))

      const tenant = await insertSelfSignupTenantBase(tx, { name: clinicName, slug, status: 'active', phone })

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
    if (tenantAttribution) {
      await persistSignupAttribution(tenantId, tenantAttribution)
    }
    if (marketingConsent && metaEventId) {
      scheduleSignupCompleteRegistration({
        eventId: metaEventId,
        email,
        phone,
        eventSourceUrl: `${appUrl}/signup`,
        ...(await metaBrowserIds(firstTouch)),
        clientIp: clientIpFromHeaders(requestHeaders),
        userAgent: requestHeaders.get('user-agent'),
      })
    }
    // Step 1 for the team; "Cadastro concluído" (and the admin e-mail)
    // follows from the onboarding save, see notifyOnboardingCompleted.
    await notifySignupStarted({
      tenantId,
      ownerName: fullName,
      ownerEmail: email,
      method: 'email',
      attribution: tenantAttribution,
    })

    const [freePlan] = await db.select().from(plans).where(eq(plans.slug, 'free')).limit(1)
    if (freePlan) {
      await createSubscription(tenantId, freePlan.id)
    }
  }

  // The tenant, user and membership rows are already committed above. If
  // Resend throws here and the error escapes, the sign-in below never runs:
  // the account exists, cannot be registered again because the email is
  // taken, and has no session to reach /confirm-email for a resend. Sending
  // must never be allowed to block sign-in.
  try {
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
  // then. There is no session for the page to read the address from, so it
  // rides in an httpOnly cookie instead of the URL that Meta sees.
  cookieStore.set(
    CONFIRM_EMAIL_STATE_COOKIE,
    serializeConfirmEmailPageState({ email }),
    confirmEmailStateCookieOptions(),
  )
  const confirmEmailUrl = new URL('/confirm-email', getAppUrl())
  if (metaEventId) {
    confirmEmailUrl.searchParams.set('meta_event_id', metaEventId)
  }
  redirect(`${confirmEmailUrl.pathname}${confirmEmailUrl.search}`)
}

export async function signUpWithGoogle() {
  await signIn('google', { redirectTo: '/signup/clinic-details' })
}

export type ClinicDetailsState = {
  error?: { clinicName?: string[]; phone?: string[]; general?: string[] }
  success?: boolean
  created?: boolean
  /** The user's only clinic is suspended; there is nothing to enter. */
  suspended?: boolean
  /**
   * An automatic start was refused because this account has been in a clinic
   * before (an inactive membership): show the clinic form instead.
   */
  needsDetails?: boolean
  metaEventId?: string
} | null

/**
 * "Sair" on clinic details. Also drops the tenant cookie: a user who only sees
 * the suspension notice never submits the form, so the action never gets the
 * chance to clear a cookie naming a clinic they cannot use.
 */
export async function signOutFromClinicDetails() {
  const cookieStore = await cookies()
  cookieStore.delete(TENANT_COOKIE)
  await signOut({ redirectTo: '/login' })
}

export async function createClinicForOAuthUser(
  _prevState: ClinicDetailsState,
  formData: FormData,
): Promise<ClinicDetailsState> {
  const requestHeaders = await headers()
  const cookieStore = await cookies()
  const { auth } = await import('@/lib/auth-config')
  const session = await auth()
  if (!session?.user?.id) {
    redirect('/login')
  }

  // Through live tenants only, exactly as the jwt callback resolves the
  // session tenant. See getClinicMemberships for the loop this prevents.
  const memberships = await getClinicMemberships(session.user.id)

  // A tenant cookie left from another account or a suspended clinic is
  // ignored by getAuthContext for anyone but a platform admin, but drop it so
  // it cannot pick the wrong clinic later. A platform admin's cookie may name
  // any clinic on purpose, so it stays.
  const isPlatformAdmin = isPlatformAdminSession(session)
  const selectedTenantId = cookieStore.get(TENANT_COOKIE)?.value
  if (!isPlatformAdmin && selectedTenantId && !memberships.liveTenantIds.includes(selectedTenantId)) {
    cookieStore.delete(TENANT_COOKIE)
  }

  if (memberships.liveTenantIds.length > 0) {
    // Same reason as the success path below: a redirect here would hand
    // /dashboard a token that still says tenantId: null and get bounced
    // straight back. This is the retry case: the clinic exists and the
    // session will resolve it, so the client only has to refresh the token.
    return { success: true, created: false }
  }

  if (memberships.suspendedOnly) {
    // The session can never resolve a suspended clinic, so "it already
    // exists, refresh" would loop. Suspension is the anti-abuse lever, so it
    // is not silently sidestepped with a new clinic either: say what happened.
    return { suspended: true, error: { general: [SUSPENDED_CLINIC_MESSAGE] } }
  }

  // `mode=auto` is the page creating the clinic by itself right after Google
  // sign-up, so the user goes straight to onboarding, which asks for the name
  // and phone once. The name is a stand-in built here from the Google profile,
  // never from the request, and the phone stays empty until onboarding.
  // Platform admins are never given a clinic unasked: they get the form.
  const auto = formData.get('mode') === 'auto'
  let clinicName: string
  let phone: string | null
  if (auto) {
    if (!memberships.neverMember || isPlatformAdmin) return { needsDetails: true }
    clinicName = placeholderClinicName(session.user.name)
    phone = null
  } else {
    const raw = {
      clinicName: formData.get('clinicName') as string,
      phone: formData.get('phone') as string,
    }

    const parsed = clinicDetailsSchema.safeParse(raw)
    if (!parsed.success) {
      return { error: parsed.error.flatten().fieldErrors }
    }
    ;({ clinicName, phone } = parsed.data)
  }

  const marketingConsent = formData.get('marketingConsent') === 'granted'
  const metaEventId = marketingConsent
    ? String(formData.get('metaEventId') || generateMetaEventId('complete_registration'))
    : null
  const firstTouch = parseFirstTouch(cookieStore.get(FIRST_TOUCH_COOKIE)?.value)
  const tenantAttribution = attributionForTenant(firstTouch, metaEventId)

  const tenant = await createSelfSignupTenant({ userId: session.user.id, clinicName, phone, placeholderName: auto })
  if (!tenant) {
    // Another request (a second tab, a double mount) created it first. Same
    // answer as the retry case above, and nothing below runs twice: no second
    // CompleteRegistration, trial or notification.
    return { success: true, created: false }
  }
  cookieStore.set(TENANT_COOKIE, tenant.id, TENANT_COOKIE_OPTIONS)
  if (tenantAttribution) {
    await persistSignupAttribution(tenant.id, tenantAttribution)
  }
  if (marketingConsent && metaEventId && session.user.email) {
    scheduleSignupCompleteRegistration({
      eventId: metaEventId,
      email: session.user.email,
      phone,
      eventSourceUrl: `${getAppUrl()}/signup/clinic-details`,
      ...(await metaBrowserIds(firstTouch)),
      clientIp: clientIpFromHeaders(requestHeaders),
      userAgent: requestHeaders.get('user-agent'),
    })
  }

  // Step 1 for the team. It names the person, not the clinic: a clinic
  // created on arrival only has a stand-in name until onboarding, which is
  // where "Cadastro concluído" (and the admin e-mail) comes from.
  await notifySignupStarted({
    tenantId: tenant.id,
    ownerName: session.user.name ?? '',
    ownerEmail: session.user.email ?? '',
    method: 'google',
    attribution: tenantAttribution,
  })

  const [freePlan] = await db.select().from(plans).where(eq(plans.slug, 'free')).limit(1)
  if (freePlan) {
    const { created } = await createSubscription(tenant.id, freePlan.id)
    if (created) {
      // A clinic created on arrival has no phone yet and has not been shown
      // the lifecycle notice (lifecycle_notice_at is null, so neither this
      // nor the daily lifecycle run can reach it). The onboarding save stamps
      // the notice and sends the welcome once the phone is in.
      if (!auto) scheduleLifecycleWelcome({ tenantId: tenant.id })
    }
  }

  // Deliberately no redirect. The JWT was minted at Google sign-in, before
  // this membership existed, so it still carries tenantId: null. Middleware
  // sends any authenticated user without a tenant back to this very page, so
  // redirecting to /dashboard here loops: the client has to refresh the
  // session first. It reports success and navigates once the token is
  // current.
  return { success: true, created: true, ...(metaEventId ? { metaEventId } : {}) }
}

type TenantAttribution = Partial<FirstTouch> & { metaEventId?: string }

async function persistSignupAttribution(
  tenantId: string,
  signupAttribution: TenantAttribution,
) {
  try {
    await db
      .update(tenants)
      .set({ signupAttribution, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
  } catch (err) {
    if (isUndefinedColumn(err)) {
      console.warn('Skipping signup attribution because tenants.signup_attribution is not migrated yet')
      return
    }
    throw err
  }
}

// metaEventId is only issued with marketing consent, so it doubles as the consent check.
function attributionForTenant(firstTouch: FirstTouch | null, metaEventId: string | null): TenantAttribution | null {
  if (metaEventId) return { ...firstTouch, metaEventId }
  return firstTouch && withoutClickIds(firstTouch)
}

function clientIpFromHeaders(requestHeaders: Pick<Headers, 'get'>): string | null {
  const forwardedFor = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (forwardedFor) return forwardedFor

  return requestHeaders.get('x-real-ip')?.trim() || null
}

async function metaBrowserIds(firstTouch: FirstTouch | null): Promise<{ fbc?: string; fbp?: string }> {
  const cookieStore = await cookies()
  const builtFbc = firstTouch?.fbclid ? buildFbc(firstTouch.fbclid, Date.parse(firstTouch.capturedAt)) : undefined
  return {
    fbc: cookieStore.get('_fbc')?.value ?? builtFbc,
    fbp: cookieStore.get('_fbp')?.value,
  }
}

function scheduleSignupCompleteRegistration(input: SendSignupCompleteRegistrationInput): void {
  try {
    after(async () => {
      await sendSignupCompleteRegistrationEvent(input)
    })
  } catch (error) {
    reportSideEffectFailure(error, {
      area: 'meta-capi',
      step: 'schedule_signup_complete_registration',
    })
  }
}
