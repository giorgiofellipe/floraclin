/**
 * The product-analytics event dictionary: every event FloraClin sends to
 * PostHog, with the only properties each may carry.
 *
 * Nothing here identifies a person. Users and clinics are referred to by
 * internal id (the distinct id and the `tenant` group key, never a property),
 * and properties are enums, counts, booleans, UTM values or form field NAMES.
 * `pickEventProperties` enforces the list at runtime too, on both SDKs, so an
 * extra key a caller sneaks past the types (an e-mail, a clinic name) is
 * dropped rather than sent.
 */
import type { FirstTouch } from '@/lib/first-touch'
import type { InAppBrowser, InAppBrowserApp } from '@/lib/in-app-browser'
import type { TimelineStage } from '@/types'

export type SignupMethod = 'google' | 'email'
export type LoginMethod = 'google' | 'email' | 'magic_link'

/**
 * Why a sign-in did not happen. A fixed set so failures group cleanly; the
 * raw Auth.js error type is mapped by {@link loginFailureFromAuthError}.
 */
export type LoginFailureReason =
  | 'invalid_credentials'
  | 'missing_fields'
  | 'oauth_error'
  | 'access_denied'
  | 'account_not_linked'
  | 'magic_link_expired'
  | 'disallowed_useragent'

export type OnboardingStepName = 'clinic' | 'procedures' | 'products' | 'team'

export type OnboardingSubmitFailureReason =
  | 'slug_taken'
  | 'validation'
  | 'subscription_expired'
  | 'forbidden'
  | 'server_error'
  | 'network_error'

/** Where an owner came from to the Indique e Ganhe tab: the `from` query param on links into it. */
export type ReferralPageSource = 'sidebar_card' | 'launch_email' | 'status_email' | 'direct'
export type ReferralPageState = 'sharing' | 'subscribe_to_unlock' | 'inactive'

export interface UtmProperties {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
}

export interface InAppBrowserProperties {
  in_app_browser: boolean
  in_app_browser_name?: InAppBrowserApp
}

interface OnboardingStepProperties {
  step_index: number
  step_name: OnboardingStepName
}

export interface AnalyticsEventProperties {
  signup_started: { method: SignupMethod } & UtmProperties & InAppBrowserProperties
  signup_completed: { method: SignupMethod } & UtmProperties
  email_confirmed: Record<string, never>
  login_succeeded: { method: LoginMethod; is_new_user: boolean }
  login_failed: { method: LoginMethod; reason: LoginFailureReason } & InAppBrowserProperties
  onboarding_step_viewed: OnboardingStepProperties
  onboarding_step_submitted: OnboardingStepProperties
  onboarding_step_validation_error: OnboardingStepProperties & { fields: string[] }
  onboarding_submit_failed: OnboardingStepProperties & { reason: OnboardingSubmitFailureReason; status?: number }
  onboarding_completed: { procedure_types_count: number; products_count: number }
  first_patient_created: Record<string, never>
  first_photo_uploaded: { kind: TimelineStage }
  first_appointment_created: Record<string, never>
  referral_page_viewed: { source: ReferralPageSource; state: ReferralPageState; counting: number }
}

export type AnalyticsEventName = keyof AnalyticsEventProperties

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
const IN_APP_KEYS = ['in_app_browser', 'in_app_browser_name'] as const
const STEP_KEYS = ['step_index', 'step_name'] as const

/** The allowlist `pickEventProperties` applies. Typed so a new event cannot be added without one. */
export const EVENT_PROPERTY_KEYS: { [E in AnalyticsEventName]: readonly (keyof AnalyticsEventProperties[E] & string)[] } = {
  signup_started: ['method', ...UTM_KEYS, ...IN_APP_KEYS],
  signup_completed: ['method', ...UTM_KEYS],
  email_confirmed: [],
  login_succeeded: ['method', 'is_new_user'],
  login_failed: ['method', 'reason', ...IN_APP_KEYS],
  onboarding_step_viewed: STEP_KEYS,
  onboarding_step_submitted: STEP_KEYS,
  onboarding_step_validation_error: [...STEP_KEYS, 'fields'],
  onboarding_submit_failed: [...STEP_KEYS, 'reason', 'status'],
  onboarding_completed: ['procedure_types_count', 'products_count'],
  first_patient_created: [],
  first_photo_uploaded: ['kind'],
  first_appointment_created: [],
  referral_page_viewed: ['source', 'state', 'counting'],
}

// A form field name, never a value: `name`, `clinic.phone`, `address[0]`.
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_.[\]-]{0,63}$/
const MAX_PROPERTY_STRING_LENGTH = 200

/**
 * Keeps only the properties the dictionary lists for `event`, and only
 * values of a harmless shape: booleans, finite numbers, short strings, and
 * (for `fields`) an array of field-name-shaped strings.
 */
export function pickEventProperties<E extends AnalyticsEventName>(
  event: E,
  properties: AnalyticsEventProperties[E] | Record<string, unknown> | undefined,
): Partial<AnalyticsEventProperties[E]> {
  const picked: Record<string, unknown> = {}
  if (!properties) return picked as Partial<AnalyticsEventProperties[E]>
  const source = properties as Record<string, unknown>

  for (const key of EVENT_PROPERTY_KEYS[event] as readonly string[]) {
    const value = source[key]
    if (value === undefined || value === null || value === '') continue
    if (key === 'fields') {
      if (Array.isArray(value)) {
        picked.fields = [...new Set(value.filter((f): f is string => typeof f === 'string' && FIELD_NAME.test(f)))]
      }
      continue
    }
    if (typeof value === 'boolean') picked[key] = value
    else if (typeof value === 'number' && Number.isFinite(value)) picked[key] = value
    else if (typeof value === 'string') picked[key] = value.slice(0, MAX_PROPERTY_STRING_LENGTH)
  }

  return picked as Partial<AnalyticsEventProperties[E]>
}

/** UTM properties from the first-touch record the signup flow already keeps. */
export function utmProperties(touch: FirstTouch | null | undefined): UtmProperties {
  if (!touch) return {}
  return {
    utm_source: touch.utmSource,
    utm_medium: touch.utmMedium,
    utm_campaign: touch.utmCampaign,
    utm_content: touch.utmContent,
    utm_term: touch.utmTerm,
  }
}

export function inAppBrowserProperties(inAppBrowser: InAppBrowser | null | undefined): InAppBrowserProperties {
  return inAppBrowser ? { in_app_browser: true, in_app_browser_name: inAppBrowser.app } : { in_app_browser: false }
}

/** Auth.js `?error=` types on /login, as a failure reason and the sign-in method they belong to. Anything else is not reported. */
export function loginFailureFromAuthError(
  error: string | undefined | null,
): { method: LoginMethod; reason: LoginFailureReason } | null {
  if (!error) return null
  switch (error) {
    case 'CredentialsSignin':
      return { method: 'email', reason: 'invalid_credentials' }
    case 'OAuthCallbackError':
    case 'OAuthSignin':
    case 'OAuthCallback':
    case 'Configuration':
      return { method: 'google', reason: 'oauth_error' }
    case 'AccessDenied':
      return { method: 'google', reason: 'access_denied' }
    case 'OAuthAccountNotLinked':
      return { method: 'google', reason: 'account_not_linked' }
    case 'Verification':
      return { method: 'magic_link', reason: 'magic_link_expired' }
    default:
      return null
  }
}

/** Auth.js provider id → the method the dictionary names. */
export function loginMethodFromProvider(provider: string | undefined | null): LoginMethod | null {
  switch (provider) {
    case 'credentials':
    case 'confirm-email':
      return 'email'
    case 'google':
      return 'google'
    case 'resend':
      return 'magic_link'
    default:
      return null
  }
}

/** Sent from the browser. Everything else is sent by the server, see `@/lib/analytics/server`. */
export const CLIENT_EVENT_NAMES = [
  'signup_started',
  'login_failed',
  'onboarding_step_viewed',
  'onboarding_step_submitted',
  'onboarding_step_validation_error',
  'onboarding_submit_failed',
  'referral_page_viewed',
] as const satisfies readonly AnalyticsEventName[]

export type ClientEventName = (typeof CLIENT_EVENT_NAMES)[number]
export type ServerEventName = Exclude<AnalyticsEventName, ClientEventName>
