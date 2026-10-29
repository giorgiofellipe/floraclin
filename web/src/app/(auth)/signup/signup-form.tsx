'use client'

import { useActionState, useRef } from 'react'
import Link from 'next/link'
import { signUp, signUpWithGoogle, type SignUpState } from '@/actions/signup'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { maskPhone } from '@/lib/masks'
import { GoogleSignIn } from '@/components/auth/google-sign-in'
import { SignupTermsNotice } from '@/components/auth/signup-terms-notice'
import type { InAppBrowser } from '@/lib/in-app-browser'
import { track } from '@/lib/analytics/client'
import { inAppBrowserProperties, type SignupMethod, type UtmProperties } from '@/lib/analytics/events'
import { ReferralCodeField } from '@/components/referral/referral-code-field'

export function SignUpForm({
  inAppBrowser,
  utm = {},
  referralEnabled,
  defaultReferralCode,
}: {
  inAppBrowser: InAppBrowser | null
  utm?: UtmProperties
  referralEnabled: boolean
  defaultReferralCode: string | null
}) {
  const [state, formAction, isPending] = useActionState<SignUpState, FormData>(signUp, null)
  // signup_started: the first focus inside the e-mail form, or the first tap
  // on Google. Once per method per page, so both paths show up in the funnel.
  const startedMethods = useRef(new Set<SignupMethod>())

  function markStarted(method: SignupMethod) {
    if (startedMethods.current.has(method)) return
    startedMethods.current.add(method)
    track('signup_started', { method, ...utm, ...inAppBrowserProperties(inAppBrowser) })
  }

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
          Gestão &middot; HOF &amp; Est&eacute;tica
        </p>
      </div>

      {/* Form section */}
      <div className="animate-fade-in-up-delay-1">
        <h2 className="text-2xl font-medium text-charcoal tracking-tight hidden lg:block">
          Criar conta
        </h2>
        <p className="text-mid text-sm mt-1 mb-8 hidden lg:block">
          Cadastre sua cl&iacute;nica na FloraClin
        </p>
        <p className="text-mid text-sm text-center mb-8 lg:hidden">
          Cadastre sua cl&iacute;nica
        </p>

        {/* Google OAuth */}
        <GoogleSignIn
          action={signUpWithGoogle}
          inAppBrowser={inAppBrowser}
          emailFallbackLabel="Cadastrar com e-mail e senha"
          emailInputId="email"
          onAttempt={() => markStarted('google')}
        />
        <SignupTermsNotice lead="Ao criar sua conta, com e-mail ou Google" />

        {/* Separator */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-sage/15" /></div>
          <div className="relative flex justify-center text-xs"><span className="bg-cream px-2 text-mid">ou cadastre-se com e-mail</span></div>
        </div>

        {state?.error?.general && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-700">{state.error.general[0]}</p>
          </div>
        )}

        {/* Signup form */}
        <form action={formAction} onFocus={() => markStarted('email')} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="fullName" className="uppercase tracking-wider text-xs text-mid">
              Nome completo
            </Label>
            <Input
              id="fullName"
              name="fullName"
              required
              autoComplete="name"
              className="auth-input h-11 border-blush/60 bg-white/80 rounded-lg transition-all duration-200 focus:border-sage focus:ring-2 focus:ring-mint/20 placeholder:text-mid/40"
              placeholder="Seu nome completo"
            />
            {state?.error?.fullName && <p className="text-xs text-red-600 mt-1">{state.error.fullName[0]}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email" className="uppercase tracking-wider text-xs text-mid">
              E-mail
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="auth-input h-11 border-blush/60 bg-white/80 rounded-lg transition-all duration-200 focus:border-sage focus:ring-2 focus:ring-mint/20 placeholder:text-mid/40"
              placeholder="seu@email.com"
            />
            {state?.error?.email && <p className="text-xs text-red-600 mt-1">{state.error.email[0]}</p>}
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
              minLength={8}
              autoComplete="new-password"
              className="auth-input h-11 border-blush/60 bg-white/80 rounded-lg transition-all duration-200 focus:border-sage focus:ring-2 focus:ring-mint/20 placeholder:text-mid/40"
              placeholder="Mínimo 8 caracteres"
            />
            {state?.error?.password && <p className="text-xs text-red-600 mt-1">{state.error.password[0]}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="clinicName" className="uppercase tracking-wider text-xs text-mid">
              Nome da clínica
            </Label>
            <Input
              id="clinicName"
              name="clinicName"
              required
              className="auth-input h-11 border-blush/60 bg-white/80 rounded-lg transition-all duration-200 focus:border-sage focus:ring-2 focus:ring-mint/20 placeholder:text-mid/40"
              placeholder="Nome da sua clínica"
            />
            {state?.error?.clinicName && <p className="text-xs text-red-600 mt-1">{state.error.clinicName[0]}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone" className="uppercase tracking-wider text-xs text-mid">
              Telefone
            </Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              required
              autoComplete="tel"
              onChange={(e) => { e.target.value = maskPhone(e.target.value) }}
              className="auth-input h-11 border-blush/60 bg-white/80 rounded-lg transition-all duration-200 focus:border-sage focus:ring-2 focus:ring-mint/20 placeholder:text-mid/40"
              placeholder="(00) 00000-0000"
            />
            {state?.error?.phone && <p className="text-xs text-red-600 mt-1">{state.error.phone[0]}</p>}
            <p className="text-xs text-mid mt-1">Você receberá dicas da FloraClin por WhatsApp e e-mail durante o teste.</p>
          </div>

          {referralEnabled && (
            <ReferralCodeField
              defaultCode={defaultReferralCode}
              labelClassName="uppercase tracking-wider text-xs text-mid"
              inputClassName="auth-input h-11 border-blush/60 bg-white/80 rounded-lg transition-all duration-200 focus:border-sage focus:ring-2 focus:ring-mint/20 placeholder:text-mid/40"
            />
          )}

          <div className="pt-1">
            <Button
              type="submit"
              disabled={isPending}
              className="w-full h-11 bg-forest text-cream hover:bg-sage uppercase tracking-wider text-sm font-medium rounded-lg transition-all duration-300 shadow-sm hover:shadow-md"
            >
              {isPending ? 'Criando conta...' : 'Criar conta'}
            </Button>
          </div>

          <p className="text-center text-sm text-mid pt-2">
            Já tem conta?{' '}
            <Link href="/login" className="font-medium text-forest hover:text-sage transition-colors duration-200">
              Fazer login
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
