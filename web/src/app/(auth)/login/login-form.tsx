'use client'

import { useActionState, useEffect, useRef } from 'react'
import { login, loginWithGoogle, type LoginState } from '@/actions/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Link from 'next/link'
import { GoogleSignIn } from '@/components/auth/google-sign-in'
import { SignupTermsNotice } from '@/components/auth/signup-terms-notice'
import { CALLBACK_URL_PARAM } from '@/lib/callback-url'
import type { InAppBrowser } from '@/lib/in-app-browser'
import { track } from '@/lib/analytics/client'
import { inAppBrowserProperties, type LoginFailureReason, type LoginMethod } from '@/lib/analytics/events'
import type { LastLoginOption } from '@/lib/last-login'

const LAST_USED_BADGE_ID = 'login-last-used'

function LastUsedBadge() {
  return (
    <span
      id={LAST_USED_BADGE_ID}
      className="absolute -top-2 right-3 rounded-full bg-mint/90 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-forest shadow-sm"
      data-testid="login-last-used"
    >
      Usado por último
    </span>
  )
}

export function LoginForm({
  inAppBrowser,
  callbackUrl,
  authError,
  authFailure = null,
  lastLogin = null,
}: {
  inAppBrowser: InAppBrowser | null
  callbackUrl: string | null
  authError: string | null
  /** The `?error=` Auth.js sent back, as an analytics reason. */
  authFailure?: { method: LoginMethod; reason: LoginFailureReason } | null
  lastLogin?: LastLoginOption | null
}) {
  const [state, formAction, isPending] = useActionState<LoginState, FormData>(login, null)

  // Once per distinct error the page was sent back with, not on every render:
  // the server page passes a fresh `authFailure` (and `inAppBrowser`) object
  // on each render.
  const reportedAuthFailure = useRef<string | null>(null)
  useEffect(() => {
    if (!authFailure) return
    const key = `${authFailure.method}:${authFailure.reason}`
    if (reportedAuthFailure.current === key) return
    reportedAuthFailure.current = key
    track('login_failed', { ...authFailure, ...inAppBrowserProperties(inAppBrowser) })
  }, [authFailure, inAppBrowser])

  // A new state object per submission, so each refused attempt counts once.
  // The action cannot tell a wrong password from an unconfirmed address.
  const reportedState = useRef<LoginState>(null)
  useEffect(() => {
    if (!state?.error || reportedState.current === state) return
    reportedState.current = state
    const reason = state.error.general ? 'invalid_credentials' : 'missing_fields'
    track('login_failed', { method: 'email', reason, ...inAppBrowserProperties(inAppBrowser) })
  }, [state, inAppBrowser])

  return (
    <div className="animate-fade-in-up">
      {/* Mobile-only branded header */}
      <div className="lg:hidden flex flex-col items-center mb-10">
        <img src="/brand/logo-sage.svg" alt="" className="size-12 mb-3" />
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          <span className="text-forest">Flora</span>
          <span className="text-sage">Clin</span>
        </h1>
        <p className="mt-1.5 text-mid text-xs tracking-[0.2em] uppercase">
          Gestão &middot; HOF &amp; Estética
        </p>
      </div>

      {/* Form section */}
      <div className="animate-fade-in-up-delay-1">
        <h2 className="text-2xl font-medium text-charcoal tracking-tight hidden lg:block">
          Acesse sua conta
        </h2>
        <p className="text-mid text-sm mt-1 mb-8 hidden lg:block">
          Entre com suas credenciais para continuar
        </p>
        <p className="text-mid text-sm text-center mb-8 lg:hidden">
          Acesse sua conta
        </p>

        {authError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3" role="alert">
            <p className="text-sm text-red-700" data-testid="login-auth-error">{authError}</p>
          </div>
        )}

        {/* Google OAuth — first */}
        <div className="relative">
          <GoogleSignIn
            action={loginWithGoogle}
            inAppBrowser={inAppBrowser}
            callbackUrl={callbackUrl}
            emailFallbackLabel="Entrar com e-mail e senha"
            emailFallbackHint="Criou a conta com o Google e não tem senha? Use “Esqueci minha senha” para criar uma."
            emailInputId="email"
            // Inside an in-app browser the tap opens our modal instead of
            // Google's 403 disallowed_useragent page: the sign-in is blocked.
            onAttempt={
              inAppBrowser
                ? () => track('login_failed', { method: 'google', reason: 'disallowed_useragent', ...inAppBrowserProperties(inAppBrowser) })
                : undefined
            }
            describedBy={lastLogin === 'google' ? LAST_USED_BADGE_ID : undefined}
          />
          {lastLogin === 'google' && <LastUsedBadge />}
        </div>

        {/* Separator */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-sage/15" /></div>
          <div className="relative flex justify-center text-xs"><span className="bg-cream px-2 text-mid">ou entre com e-mail</span></div>
        </div>

        {/* Email + password form */}
        <form action={formAction} className="space-y-5">
          {callbackUrl && <input type="hidden" name={CALLBACK_URL_PARAM} value={callbackUrl} />}
          <div className="space-y-1.5">
            <Label htmlFor="email" className="uppercase tracking-wider text-xs text-mid">
              E-mail
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              data-testid="login-email"
              className="auth-input h-11 border-blush/60 bg-white/80 rounded-lg transition-all duration-200 focus:border-sage focus:ring-2 focus:ring-mint/20 placeholder:text-mid/40"
              placeholder="seu@email.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="uppercase tracking-wider text-xs text-mid">
              Senha
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              data-testid="login-password"
              className="auth-input h-11 border-blush/60 bg-white/80 rounded-lg transition-all duration-200 focus:border-sage focus:ring-2 focus:ring-mint/20 placeholder:text-mid/40"
              placeholder="Sua senha"
            />
          </div>
          {state?.error?.general && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-700" data-testid="login-error">{state.error.general[0]}</p>
              {/* An unconfirmed account is refused here and looks exactly like
                  a wrong password, so the message alone leaves a new customer
                  stuck on the credentials they just chose. The error cannot
                  say which case it is without revealing whether the address
                  has an account, so it offers the route out instead. */}
              <p className="mt-2 text-sm text-red-700">
                Ainda não confirmou seu e-mail?{' '}
                <Link href="/confirm-email" className="font-medium underline" data-testid="login-confirm-link">
                  Reenviar link de confirmação
                </Link>
              </p>
            </div>
          )}
          <div className="relative mt-1">
            <Button
              type="submit"
              aria-describedby={lastLogin === 'email' ? LAST_USED_BADGE_ID : undefined}
              className="w-full h-11 bg-forest text-cream hover:bg-sage uppercase tracking-wider text-sm font-medium rounded-lg transition-all duration-300 shadow-sm hover:shadow-md"
              disabled={isPending}
              data-testid="login-submit"
            >
              {isPending ? 'Entrando...' : 'Entrar'}
            </Button>
            {lastLogin === 'email' && <LastUsedBadge />}
          </div>
          <div className="text-center pt-2">
            <Link
              href="/reset-password"
              className="text-sm text-mid/70 hover:text-sage transition-colors duration-200"
            >
              Esqueci minha senha
            </Link>
          </div>
        </form>

        <p className="mt-6 text-center text-sm text-mid">
          Não tem conta?{' '}
          <Link href="/signup" className="font-medium text-forest hover:text-sage">
            Criar conta
          </Link>
        </p>
        <SignupTermsNotice lead="Ao acessar ou criar a conta" />
      </div>
    </div>
  )
}
