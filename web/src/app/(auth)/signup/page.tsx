'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { signUp, signUpWithGoogle, type SignUpState } from '@/actions/signup'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { maskPhone } from '@/lib/masks'

function GoogleIcon() {
  return (
    <svg className="size-4 mr-2" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

export default function SignUpPage() {
  const [state, formAction, isPending] = useActionState<SignUpState, FormData>(signUp, null)

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
        <form action={signUpWithGoogle}>
          <Button type="submit" variant="outline" className="w-full h-11 border-sage/20 rounded-lg">
            <GoogleIcon /> Criar conta com Google
          </Button>
        </form>

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
        <form action={formAction} className="space-y-5">
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
          </div>

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
