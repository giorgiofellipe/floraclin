import { after } from 'next/server'
import { notifyDiscord, type SignupMethod } from '@/lib/discord'
import { sendNewSignupNotification } from '@/lib/email'

/**
 * The team follows a self sign-up in two steps: "Novo cadastro (onboarding
 * pendente)" when the account and clinic are created, and "Cadastro
 * concluído" once onboarding is finished for the first time. A sign-up that
 * never finishes onboarding shows up as the first message alone.
 */
export async function notifySignupStarted(input: {
  tenantId: string
  ownerName: string
  ownerEmail: string
  method: SignupMethod
  attribution?: { utmSource?: string; utmCampaign?: string } | null
}): Promise<void> {
  await notifyDiscord({
    kind: 'signup.started',
    tenantId: input.tenantId,
    ownerName: input.ownerName,
    ownerEmail: input.ownerEmail,
    method: input.method,
    // Only the two UTM fields: the rest of the first touch (click ids, the
    // Meta event id) is not for the team channel.
    attribution: input.attribution
      ? { utmSource: input.attribution.utmSource, utmCampaign: input.attribution.utmCampaign }
      : null,
  })
}

/**
 * Call only for the first completion (see markOnboardingCompleted): both the
 * Discord post and the admin e-mail go out once per clinic.
 */
export async function notifyOnboardingCompleted(input: {
  tenantId: string
  clinicName: string
  phone: string | null
  city: string | null
  state: string | null
  signedUpAt: Date
  ownerName: string
  ownerEmail: string
}): Promise<void> {
  await notifyDiscord({
    kind: 'onboarding.completed',
    tenantId: input.tenantId,
    tenantName: input.clinicName,
    phone: input.phone,
    city: input.city,
    state: input.state,
    elapsed: formatElapsedSince(input.signedUpAt),
  })

  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL
  if (!adminEmail) return
  const sendAdminEmail = () =>
    sendNewSignupNotification({
      adminEmail,
      clinicName: input.clinicName,
      ownerName: input.ownerName,
      ownerEmail: input.ownerEmail,
      phone: input.phone || 'Não informado',
    }).catch(() => {})
  // after() keeps a serverless function alive until the e-mail is sent; it
  // throws outside a request scope, where the send just starts in place.
  try {
    after(sendAdminEmail)
  } catch {
    void sendAdminEmail()
  }
}

const MINUTE_MS = 60_000
const HOUR_MINUTES = 60
const DAY_MINUTES = 24 * HOUR_MINUTES

/** "em 4 min", "em 2 h 5 min", "em 3 dias". */
export function formatElapsedSince(from: Date, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - from.getTime()) / MINUTE_MS))
  if (minutes < 1) return 'em menos de 1 min'
  if (minutes < HOUR_MINUTES) return `em ${minutes} min`
  if (minutes < DAY_MINUTES) {
    const hours = Math.floor(minutes / HOUR_MINUTES)
    const rest = minutes % HOUR_MINUTES
    return rest ? `em ${hours} h ${rest} min` : `em ${hours} h`
  }
  const days = Math.floor(minutes / DAY_MINUTES)
  return days === 1 ? 'em 1 dia' : `em ${days} dias`
}
