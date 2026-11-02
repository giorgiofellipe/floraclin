import { auth } from '@/lib/auth-config'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { CONFIRM_EMAIL_STATE_COOKIE, parseConfirmEmailPageState } from '@/lib/confirm-email-page-state'
import { AlreadyConfirmed, ConfirmActions } from './confirm-actions'
import { RequestConfirmationForm } from './request-confirmation-form'
import { SignupConversionTracker } from './signup-conversion-tracker'
import { AnalyticsProvider } from '@/components/analytics/analytics-provider'
import { isUserEmailVerified } from '@/db/queries/users'

interface ConfirmEmailPageProps {
  searchParams: Promise<{ meta_event_id?: string }>
}

export default async function ConfirmEmailPage({ searchParams }: ConfirmEmailPageProps) {
  const { meta_event_id: metaEventId } = await searchParams
  const session = await auth()
  const cookieStore = await cookies()
  const pageState = parseConfirmEmailPageState(cookieStore.get(CONFIRM_EMAIL_STATE_COOKIE)?.value)

  // The database, not the token: the token's claim is minted at sign-in and
  // stays `false` after the address is confirmed in another browser, which
  // kept showing this page to people who had already confirmed.
  if (session?.user?.id && (await isUserEmailVerified(session.user.id))) redirect('/onboarding')

  const email = pageState?.email ?? session?.user?.email ?? null
  const hasToken = !!pageState?.token
  const alreadyConfirmed = !!pageState?.confirmed
  let heading = 'Confirme seu e-mail'
  if (alreadyConfirmed) heading = 'Seu e-mail já está confirmado'
  else if (hasToken) heading = 'Falta só um toque'

  let body = <RequestConfirmationForm />
  if (email && alreadyConfirmed) body = <AlreadyConfirmed email={email} />
  else if (email) body = <ConfirmActions email={email} hasToken={hasToken} signedIn={!!session?.user?.id} />

  return (
    <div className="min-h-screen flex items-center justify-center bg-cream px-6">
      <SignupConversionTracker eventId={metaEventId ?? null} />
      <AnalyticsProvider />
      <div className="w-full max-w-md text-center">
        <img src="/brand/logo-mint.svg" alt="" className="size-16 mx-auto mb-6" />
        <h1 className="font-display text-3xl font-semibold text-charcoal">
          Flora<span className="text-sage">Clin</span>
        </h1>
        <p className="mt-2 text-lg font-medium text-charcoal">
          {heading}
        </p>
        <div className="mt-8 rounded-lg bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-left">
          {/* The address comes from the confirm-email cookie (the link set it)
              or from the session signup opened. Without either, the owner
              can ask for a new link here instead of being bounced to /login. */}
          {body}
        </div>
      </div>
    </div>
  )
}
