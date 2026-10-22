'use client'

import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Loader2Icon } from 'lucide-react'
import { createClinicForOAuthUser, signOutFromClinicDetails, type ClinicDetailsState } from '@/actions/signup'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { maskPhone } from '@/lib/masks'
import { SignupAttributionFields } from '@/components/marketing/signup-attribution-fields'
import { generateMetaEventId, trackMetaEvent } from '@/lib/marketing-attribution'
import { cookieConsentStatus } from '@/lib/cookie-consent'
import { SUSPENDED_CLINIC_MESSAGE } from '@/lib/clinic-suspended'

export const MAX_SESSION_REFRESH_ATTEMPTS = 3
// Long enough for an in-flight session fetch (which makes update() a no-op) to finish.
export const SESSION_REFRESH_RETRY_MS = 500

export const AUTO_START_FAILED_MESSAGE =
  'Não conseguimos preparar sua clínica. Verifique sua conexão e toque em “Tentar de novo”.'

export const SESSION_REFRESH_FAILED_MESSAGE =
  'Sua clínica está pronta, mas não conseguimos atualizar sua sessão. Toque em “Tentar de novo”. Se não funcionar, saia e entre de novo.'

type Props = {
  /** The user already has a live clinic; only the session is behind. */
  hasClinic?: boolean
  /** The user's only clinic is suspended. */
  suspended?: boolean
  /**
   * A brand-new account: create the clinic straight away and go to
   * onboarding, which asks for the clinic name and phone. The form is only
   * shown if the server refuses (`needsDetails`).
   */
  autoStart?: boolean
}

export function ClinicDetailsForm({ hasClinic = false, suspended = false, autoStart = false }: Props) {
  const [formState, formAction, isPending] = useActionState<ClinicDetailsState, FormData>(createClinicForOAuthUser, null)
  // The automatic start calls the action directly rather than through
  // useActionState, so a network or server failure lands here as a retry
  // button instead of the error boundary.
  const [autoState, setAutoState] = useState<ClinicDetailsState>(null)
  const [autoFailed, setAutoFailed] = useState(false)
  // Latched at mount: the action sets the tenant cookie, which re-renders this
  // page from the server with autoStart false (the account is a member now).
  // That must not swap the progress screen for the form mid-refresh.
  const [autoMode] = useState(autoStart)
  // A form submit (after `needsDetails`) supersedes the automatic attempt.
  const state = formState ?? autoState
  const router = useRouter()
  const { update } = useSession()
  const [entering, setEntering] = useState(false)
  const [refreshFailed, setRefreshFailed] = useState(false)

  // The action deliberately does not redirect. This session's JWT was minted
  // at Google sign-in, before any membership existed, so it still says
  // tenantId: null, and middleware sends anyone in that state straight back
  // here. Navigating without refreshing the token first is an infinite loop
  // between this page and itself.
  //
  // Two traps here. `update()` with no argument is a plain GET of the session,
  // which never runs the jwt callback with trigger 'update', so the token kept
  // tenantId: null and middleware bounced /dashboard straight back to this
  // page. Passing any data makes it the POST that refreshes the token. And
  // `update` changes identity every time the session does, so this effect
  // re-ran after each refresh: it looped, firing CompleteRegistration on every
  // pass. Each action result is handled once. update() returns nothing while
  // the provider is still loading and null when the fetch fails, so the
  // refresh is retried a few times. If none yields a tenant, navigating anyway
  // is the loop again (middleware sends a tenantless token straight back
  // here), so stop and say so. Retrying the refresh, or signing in again
  // (which mints a token from the current memberships), is the way out; a
  // plain reload is not, as it never re-runs the jwt membership lookup.
  //
  // A clinic created just now goes to onboarding directly; /dashboard would
  // get there too (the platform layout sends unfinished clinics on) but with
  // an extra redirect.
  const destination = useRef('/dashboard')
  const refreshThenEnter = useCallback(async (): Promise<boolean> => {
    for (let attempt = 1; attempt <= MAX_SESSION_REFRESH_ATTEMPTS; attempt++) {
      const fresh = (await update({})) as { tenantId?: string | null } | null | undefined
      if (fresh?.tenantId) {
        router.replace(destination.current)
        return true
      }
      if (attempt < MAX_SESSION_REFRESH_ATTEMPTS) await new Promise((r) => setTimeout(r, SESSION_REFRESH_RETRY_MS))
    }
    return false
  }, [update, router])

  const enterOrExplain = useCallback(() => {
    void refreshThenEnter().then((entered) => {
      if (entered) return
      setEntering(false)
      setRefreshFailed(true)
    })
  }, [refreshThenEnter])

  const handledState = useRef<ClinicDetailsState>(null)
  useEffect(() => {
    if (!state?.success || handledState.current === state) return
    handledState.current = state
    // A clinic made on arrival is always new to its owner, even when a
    // concurrent request or a retry finds it already made.
    if (state.created || autoMode) destination.current = '/onboarding'
    if (state.created && state.metaEventId) {
      trackMetaEvent('CompleteRegistration', { status: 'trial_started', signup_method: 'google' }, state.metaEventId)
    }
    enterOrExplain()
  }, [state, enterOrExplain, autoMode])

  // Consent is read when the request goes out, not from a hydrated hidden
  // field: on an automatic start that runs right after mount, the field would
  // still hold its server snapshot ('unset') and drop a consent the visitor
  // already gave on the sign-up page. No consent, no event id: the server
  // then sends no CAPI event and the browser fires no pixel event.
  // One event id for every attempt, so a retry after a lost response cannot
  // count the same sign-up twice on Meta's side.
  const autoEventId = useRef<string | null>(null)
  const startAutomatically = useCallback(() => {
    const data = new FormData()
    data.set('mode', 'auto')
    if (cookieConsentStatus() === 'granted') {
      autoEventId.current ??= generateMetaEventId('complete_registration')
      data.set('marketingConsent', 'granted')
      data.set('metaEventId', autoEventId.current)
    }
    createClinicForOAuthUser(null, data).then(setAutoState, () => setAutoFailed(true))
  }, [])

  // Once per mount, never retried on its own: a failure waits for the user.
  // The server is idempotent anyway (a second request finds the clinic and
  // creates nothing), so a double mount cannot make two clinics or events.
  const autoStarted = useRef(false)
  useEffect(() => {
    if (!autoMode || autoStarted.current) return
    autoStarted.current = true
    startAutomatically()
  }, [autoMode, startAutomatically])

  const brand = (
    <div className="flex items-center gap-2 mb-8 lg:hidden">
      <img src="/brand/logo-mint.svg" alt="" className="size-8" />
      <span className="font-display text-xl font-semibold text-charcoal">
        Flora<span className="text-sage">Clin</span>
      </span>
    </div>
  )

  const enter = () => {
    setEntering(true)
    setRefreshFailed(false)
    enterOrExplain()
  }
  // While the token refresh after a successful submit is running.
  const refreshing = !!state?.success && !refreshFailed
  let submitLabel = 'Continuar'
  if (isPending) submitLabel = 'Criando clínica...'
  else if (refreshing) submitLabel = 'Entrando...'
  const signOutButton = (
    <Button type="button" size="sm" variant="outline" onClick={() => void signOutFromClinicDetails()}>
      Sair
    </Button>
  )

  const refreshFailedAlert = refreshFailed && (
    <div role="alert" className="mb-4 space-y-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      <p>{SESSION_REFRESH_FAILED_MESSAGE}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={entering} onClick={enter}>
          Tentar de novo
        </Button>
        {signOutButton}
      </div>
    </div>
  )

  if (suspended || state?.suspended) {
    return (
      <div>
        {brand}
        <h2 className="text-2xl font-semibold text-charcoal">Clínica suspensa</h2>
        {/* Announced only when it is the answer to a submit. */}
        <p role={state?.suspended ? 'alert' : undefined} className="text-sm text-mid mt-2 mb-6">{SUSPENDED_CLINIC_MESSAGE}</p>
        {signOutButton}
      </div>
    )
  }

  // Automatic start: until the server answers, while the session refreshes,
  // or after a failure. `needsDetails` drops through to the form.
  if (autoMode && !formState && !autoState?.needsDetails) {
    return (
      <div>
        {brand}
        <h2 className="text-2xl font-semibold text-charcoal">Preparando sua clínica…</h2>
        <p className="text-sm text-mid mt-1 mb-6">Em seguida você configura nome, telefone e procedimentos.</p>
        {refreshFailedAlert}
        {autoFailed && (
          <div role="alert" className="mb-4 space-y-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            <p>{AUTO_START_FAILED_MESSAGE}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setAutoState(null)
                  setAutoFailed(false)
                  startAutomatically()
                }}
              >
                Tentar de novo
              </Button>
              {signOutButton}
            </div>
          </div>
        )}
        {!autoFailed && !refreshFailed && (
          <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-mid">
            <Loader2Icon className="size-4 animate-spin text-sage" aria-hidden />
            {autoState?.success ? 'Entrando...' : 'Criando sua clínica...'}
          </div>
        )}
      </div>
    )
  }

  // A cookie change in the action re-renders this page with hasClinic set;
  // that must not swap out the form while its own refresh is running.
  if (hasClinic && !state) {
    return (
      <div>
        {brand}
        <h2 className="text-2xl font-semibold text-charcoal">Sua clínica já está cadastrada</h2>
        <p className="text-sm text-mid mt-1 mb-6">Falta só entrar nela.</p>
        {/* After a failed refresh the alert's own "Tentar de novo" is the retry. */}
        {refreshFailedAlert || (
          <Button
            type="button"
            disabled={entering}
            onClick={enter}
            className="w-full bg-forest text-cream hover:bg-sage"
          >
            {entering ? 'Entrando...' : 'Entrar na clínica'}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div>
      {brand}

      <h2 className="text-2xl font-semibold text-charcoal">Dados da clínica</h2>
      <p className="text-sm text-mid mt-1 mb-6">Preencha os dados da sua clínica para continuar.</p>

      {refreshFailedAlert}
      {state?.error?.general && (
        <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error.general[0]}
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <SignupAttributionFields />
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
          <p className="text-xs text-mid mt-1">Você receberá dicas da FloraClin por WhatsApp e e-mail durante o teste.</p>
        </div>

        <Button type="submit" disabled={isPending || refreshing} className="w-full bg-forest text-cream hover:bg-sage">
          {submitLabel}
        </Button>
      </form>
    </div>
  )
}
